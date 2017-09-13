"use strict";

const Shell = require('../utils/Shell');
const getos = require('getos');
const fs = require('mz/fs');
const NumberPadder = require('../utils/NumberPadder');
const MkDir = require('../utils/MkDir');

/**
 * @typedef {Number} SambaPermission
 */

/**
 * @typedef {object} SambaAcl
 * @property {SambaPermission} permission
 * @property {String} password
 */

/**
 * @typedef {Object.<{String, SambaAcl}>} SambaAclList
 */

/**
 * @typedef {object} SambaShare
 * @property {string} image
 * @property {string} pool
 * @property {string} id
 * @property {SambaPermission} guest
 * @property {SambaAclList} acl
 * @property {string} name
 * @property {string} comment
 * @property {boolean} browsable
 */

/**
 * @typedef {Object.<String, Object.<String, String>>} SambaUnpackedConfig
 */

class SambaClient {
  /**
   * @param {RbdClient} rbdClient
   */
  constructor(rbdClient) {
    this._os = null;
    this._rbdClient = rbdClient;
  }

  /**
   * @returns {RbdClient}
   */
  get rbd() {
    return this._rbdClient;
  }

  /**
   * @returns {Promise.<{
   * centos: boolean,
   * ubuntu: boolean
   * }>}
   * @private
   */
  _distro() {
    return new Promise((resolve, reject) => {
      if (this._os) {
        resolve(this._os);
      }
      else {
        getos((e, os) => {
          if (e) {
            reject(e);
          }
          else {
            const dist = os.dist.toLowerCase();

            this._os = {
              centos: dist.indexOf('centos') >= 0,
              ubuntu: dist.indexOf('ubuntu') >= 0
            };

            resolve(this._os);
          }
        });
      }
    });
  }

  /**
   * @param {string} user
   * @param {string} password
   * @returns {Promise.<void>}
   * @private
   */
  async _passwd(user, password) {
    await Shell.execStdIn(`${password}\n${password}\n`, 'smbpasswd', '-a', user);
  }

  /**
   * @param {string} user
   * @returns {Promise.<void>}
   * @private
   */
  async _adduser(user) {
    const distro = await this._distro();

    if (distro.ubuntu) {
      await Shell.execStdIn('\n\n\n\n\nY\n',
        'adduser', '--no-create-home', '--disabled-password', '--disabled-login', user);
    }
    else if (distro.centos) {
      await Shell.exec('useradd', '--no-create-home', user);
      await Shell.exec('usermod', '-s', '/sbin/nologin', user);
    }
    else {
      throw new Error(`unrecognized OS: ${JSON.stringify(distro)}`);
    }
  }

  /**
   * @param {string} user
   * @returns {Promise.<void>}
   * @private
   */
  async _deluser(user) {
    const distro = await this._distro();

    if (distro.ubuntu) {
      await Shell.exec('deluser', '--remove-home', user);
    }
    else if (distro.centos) {
      await Shell.exec('userdel', '--remove', user);
    }
    else {
      throw new Error(`unrecognized OS: ${JSON.stringify(distro)}`);
    }
  }

  /**
   * @param {string} user
   * @param {string} group
   * @returns {Promise.<void>}
   * @private
   */
  async _addUserToGroup(user, group) {
    await Shell.exec('gpasswd', '-a', user, group);
  }

  /**
   * @param {string} path
   * @returns {Promise.<void>}
   * @private
   */
  async _enableSeLinuxOnPath(path) {
    await Shell.exec('chcon', '-t', 'samba_share_t', path);
  }

  /**
   * @returns {Promise.<void>}
   * @private
   */
  async _restartSamba() {
    const distro = await this._distro();

    if (distro.ubuntu) {
      await Shell.exec('systemctl restart smbd');
    }
    else if (distro.centos) {
      await Shell.exec('systemctl restart smb.service');
    }
    else {
      throw new Error(`unrecognized os: ${JSON.stringify(distro)}`);
    }
  }

  /**
   * @param {SambaUnpackedConfig} pack
   * @returns {string}
   * @private
   */
  _packSambaConfigStr(pack) {
    return Object.entries(pack)
      .map(([section, config]) => `[${section}]\n` +
        Object.entries(config)
          .map(([key, value]) => `\t${key} = ${value}\n`)
          .join()
      + '\n');
  }

  /**
   * @param {string} content
   * @returns {SambaUnpackedConfig}
   * @private
   */
  _unpackSambaConfigStr(content) {
    return content
      .split('\n')
      .map(line => line.replace(/#.*$/g, '').replace(/;.*$/g, ''))
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .reduce((prev, cur) => {
        if (cur.startsWith('[')) {
          prev.push([cur]);
        }
        else {
          prev[prev.length - 1].push(cur);
        }

        return prev;
      }, []).reduce((prev, cur) => {
        if (cur.length < 1) {
          throw new Error(`syntax error parsing: ${content}`);
        }

        const [header, ...rest] = cur;

        if (!header.startsWith('[') || !header.endsWith(']')) {
          throw new Error(`syntax error parsing: ${content}`);
        }

        return Object.assign(prev, {
          [header.substr(1, header.length - 2)]: rest.reduce((prev2, cur2) => {
            const index = cur2.indexOf('=');

            if (index < 0) {
              throw new Error(`syntax error parsing: ${content}`);
            }

            return Object.assign(prev2, {
              [cur2.substr(0, index).trim()]: cur2.substr(index + 1).trim()
            });
          }, {})
        });
      }, {});
  }

  /**
   * @param {SambaShare} share
   * @returns {SambaUnpackedConfig}
   * @private
   */
  _generateSambaConfig(share) {
    let result = {
      path: this.rbd.generateAutoMountPath({image: share.image, pool: share.pool}),
      browsable: share.browsable ? 'yes' : 'no',
      'force user': 'root',
      'force group': 'root'
    };

    if (share.comment) {
      result = Object.assign(result, {
        comment: share.comment
      });
    }

    const [deniedUsers, readUsers, writeUsers] = [0, 2, 3].map(perm =>
      Object.entries(share.acl)
        .filter(([,acl]) => acl.permission === perm)
        .map(([user]) => user));

    const validUsers = readUsers.concat(writeUsers);

    if (share.guest === 0) {
      result = Object.assign(result, {
        'guest ok': 'no',
        'read only': 'yes'
      });

      if (validUsers.length > 0) {
        result = Object.assign(result, {
          'valid users': validUsers.join(' ')
        });
      }

      if (writeUsers.length > 0) {
        const list = writeUsers.join(' ');

        result = Object.assign(result, {
          'write list': list,
          'admin users': list
        });
      }
    }
    else if (share.guest === 2) {
      result = Object.assign(result, {
        'guest ok': 'yes',
        'read only': 'yes'
      });

      if (deniedUsers.length > 0) {
        result = Object.assign(result, {
          'invalid users': deniedUsers.join(' ')
        });
      }

      if (writeUsers.length > 0) {
        result = Object.assign(result, {
          'write list': writeUsers.join(' ')
        });
      }
    }
    else if (share.guest === 3) {
      result = Object.assign(result, {
        'guest ok': 'yes',
        'read only': 'no'
      });

      if (deniedUsers.length > 0) {
        result = Object.assign(result, {
          'invalid users': deniedUsers.join(' ')
        });
      }

      if (readUsers.length > 0) {
        result = Object.assign(result, {
          'read list': readUsers.join(' ')
        });
      }
    }

    return {
      [share.name]: result
    };
  }

  /**
   * @param {SambaUnpackedConfig} oldPack
   * @param {SambaUnpackedConfig} newPack
   * @returns {boolean}
   * @private
   */
  _requiresRestart(oldPack, newPack) {
      return Object.entries(oldPack)
        .some(([section, config]) => !(section in newPack) ||
          Object.entries(config)
            .some(([key, value]) => !(key in newPack[section]) || value !== newPack[section][key])) ||
        Object.entries(newPack)
          .some(([section, config]) => !(section in oldPack) ||
            Object.entries(config)
              .some(([key, value]) => !(key in oldPack[section]) || value !== oldPack[section][key]));
  }

  /**
   * @returns {Promise.<SambaUnpackedConfig>}
   * @private
   */
  async _readConfig() {
    return this._unpackSambaConfigStr(await fs.readFile('/etc/samba/smb.conf'));
  }

  /**
   * @param {SambaUnpackedConfig} pack
   * @returns {Promise.<void>}
   * @private
   */
  async _writeConfig(pack) {
    const content = this._packSambaConfigStr(pack);
    const now = new Date();
    const ts = `${now.getFullYear()}.${NumberPadder.pad(now.getMonth() + 1, 2)}.${NumberPadder.pad(now.getDate(), 2)}`;
    const tmpFile = `/var/lib/kaveh-smb-backup/smb.conf.${ts}`;

    await MkDir.path('/var/lib/kaveh-smb-backup');
    await fs.copyFile('/etc/samba/smb.conf', tmpFile);
    await fs.writeFile('/etc/samba/smb.conf', content);
  }

  /**
   * @param {SambaUnpackedConfig} pack
   * @returns {Promise.<Array.<SambaShare>>}
   * @private
   */
  async _parseShares(pack) {
    Object.entries(pack)
      .filter(([key]) => key !== 'global' && key !== 'printers' && !key.endsWith('$'))
      .map(([share, config]) => {
        if (!('path' in config)) {
          return null;
        }

        let allowGuest = false;
        let readOnly = true;
        let browsable = true;
        let path = config['path'];
        let comment = ('comment' in config) ? config['comment'] : '';

        if ('guest ok' in config) {
          allowGuest = config['guest ok'].toLowerCase() === 'yes';
        }

        if ('writable' in config) {
          readOnly = !(config['writable'].toLowerCase() === 'yes');
        }
        else if ('writeable' in config) {
          readOnly = !(config['writeable'].toLowerCase() === 'yes');
        }
        else if ('read only' in config) {
          readOnly = config['read only'].toLowerCase() === 'yes';
        }

        if ('browsable' in config) {
          browsable = config['browsable'].toLowerCase() === 'yes';
        }
        else if ('browseable' in config) {
          browsable = config['browseable'].toLowerCase() === 'yes';
        }
      });
  }
}

module.exports = SambaClient;
