"use strict";

const Shell = require('../utils/Shell');
const fs = require('mz/fs');
const NumberPadder = require('../utils/NumberPadder');
const MkDir = require('../utils/MkDir');
const ImageNameParser = require('../utils/ImageNameParser');
const os = require('os');
const RbdClient = require('../rbd');
const log = require('logging').default('SambaClient');
const ErrorFormatter = require('../utils/ErrorFormatter');
const FileUtils = require('../utils/FileUtils');
const Distro = require('../utils/Distro');

/**
 * @typedef {Number} SambaPermission
 */

/**
 * @typedef {object} SambaAcl
 * @property {SambaPermission} permission
 * @property {String|null} password
 */

/**
 * @typedef {Object.<String, SambaAcl>} SambaAclList
 */

/**
 * @typedef {object} SambaShare
 * @property {string} image
 * @property {string} pool
 * @property {string} id
 * @property {SambaPermission} guest
 * @property {SambaAclList} acl
 * @property {string} name
 * @property {string|null} comment
 * @property {boolean} browsable
 * @property {number|null} capacity
 * @property {number|null} used
 * @property {string|null} host
 */

/**
 * @typedef {Object.<String, Object.<String, String>>} SambaUnpackedConfig
 */

class SambaClient {
  static async capable() {
    try {
      if (!(await RbdClient.capable())) {
        return false;
      }

      const client = new SambaClient({});
      await client._getSambaStatus();

      const testUser = '___samba_test___';

      try {
        await client._delUser(testUser);
      }
      catch (err) {
      }

      await client._addUser(testUser);
      await client._passwd(testUser, '1234');
      await client._delUser(testUser);

      return true;
    }
    catch (err) {
      log.error(ErrorFormatter.format(err));
      return false;
    }
  }

  /**
   * @param {{db: LevelDb}} opts
   */
  constructor(opts) {
    this._db = opts.db;
    this._rbdClient = new RbdClient(opts);
  }

  /**
   * @returns {RbdClient}
   */
  get rbd() {
    return this._rbdClient;
  }

  /**
   * @param {string} user
   * @param {string} password
   * @returns {Promise.<void>}
   * @private
   */
  async _passwd(user, password) {
    await Shell.exec(`(echo ${password}; echo ${password}) | smbpasswd -s -a ${user}`);
  }

  /**
   * @param {string} user
   * @returns {Promise.<void>}
   * @private
   */
  async _addUser(user) {
    await Shell.exec('useradd', '--no-create-home', user);
    await Shell.exec('usermod', '-s', '/sbin/nologin', user);
  }

  /**
   * @param {string} user
   * @returns {Promise.<void>}
   * @private
   */
  async _delUser(user) {
    const distro = await Distro.getDistro();

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
    try {
      await Shell.exec('chcon', '-t', 'samba_share_t', path);
    }
    catch (err) {
    }
  }

  /**
   * @returns {Promise.<Array.<string>>}
   * @private
   */
  async _lsUsers() {
    return (await Shell.exec('cat /etc/passwd'))
      .split('\n')
      .map(x => x.trim())
      .filter(x => x.length > 0)
      .map(x => {
        const index = x.indexOf(':');

        if (index < 0) {
          throw new Error(`unable top parse passwd line: ${x}`);
        }

        return x.substr(0, index).trim();
      });
  }

  /**
   * @param {string} user
   * @returns {Promise.<boolean>}
   * @private
   */
  async _userExists(user) {
    return (await this._lsUsers()).indexOf(user) >= 0;
  }

  /**
   * @param {string} user
   * @returns {Promise.<void>}
   * @private
   */
  async _ensureUser(user) {
    if (!(await this._userExists(user))) {
      await this._addUser(user);
    }
  }

  /**
   * @returns {Promise.<void>}
   * @private
   */
  async _restartSamba() {
    const distro = await Distro.getDistro();

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
   * @returns {Promise.<void>}
   */
  async postRbdMount() {
    await this._restartSamba();
  }

  /**
   * @returns {Promise.<String>}
   * @private
   */
  async _getSambaStatus() {
    const distro = await Distro.getDistro();

    if (distro.ubuntu) {
      await Shell.exec('systemctl status smbd');
    }
    else if (distro.centos) {
      await Shell.exec('systemctl status smb.service');
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
          .join('')
      + '\n').join('');
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
        const list = writeUsers.join(' ');

        result = Object.assign(result, {
          'write list': list,
          'admin users': list
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
    return this._unpackSambaConfigStr(await fs.readFile('/etc/samba/smb.conf', {encoding: 'utf8'}));
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
    await FileUtils.copyFile('/etc/samba/smb.conf', tmpFile);
    await fs.writeFile('/etc/samba/smb.conf', content);
  }

  /**
   * @param {SambaUnpackedConfig} pack
   * @returns {Array.<SambaShare>}
   * @private
   */
  _parseShares(pack) {
    return Object.entries(pack)
      .filter(([key]) => key !== 'global' && key !== 'printers' && !key.endsWith('$'))
      .map(([share, config]) => {
        if (!('path' in config)) {
          return null;
        }

        let path = config['path'];
        let name = null;

        try {
          name = this.rbd.parseAutoMountPath(path);
        }
        catch (err) {
          return null;
        }

        let allowGuest = false;
        let readOnly = true;
        let browsable = true;
        let comment = ('comment' in config) ? config['comment'] : '';
        let acl = {};

        let [validUsers, invalidUsers, readList, writeList, adminUsers] =
          ['valid users', 'invalid users', 'read list', 'write list', 'admin users']
            .map(key => (key in config) ? config[key].split(/\s+/) : []);
        writeList = writeList.concat(adminUsers.filter(x => writeList.indexOf(x) < 0));
        validUsers = validUsers.concat(readList.filter(x => validUsers.indexOf(x) < 0))
        validUsers = validUsers.concat(writeList.filter(x => validUsers.indexOf(x) < 0));
        invalidUsers = invalidUsers.filter(x => validUsers.indexOf(x) < 0);

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

        if (readOnly) {
          acl = validUsers.map(user => ({
            [user]: {
              permission: 2,
              password: null
            }
          })).concat(invalidUsers.map(user => ({
            [user]: {
              permission: 0,
              password: null
            }
          }))).reduce((prev, cur) => Object.assign(prev, cur), {});

          for (const user of writeList) {
            acl[user].permission = 3;
          }
        }
        else {
          acl = validUsers.map(user => ({
            [user]: {
              permission: 3,
              password: null
            }
          })).concat(invalidUsers.map(user => ({
            [user]: {
              permission: 0,
              password: null
            }
          }))).reduce((prev, cur) => Object.assign(prev, cur), {});

          for (const user of readList) {
            acl[user].permission = 2;
          }
        }

        return {
          image: name.image,
          pool: name.pool,
          id: 'admin',
          guest: allowGuest ? (readOnly ? 2 : 3) : 0,
          acl: acl,
          name: share,
          comment: comment,
          browsable: browsable,
          capacity: null,
          used: null,
          host: os.hostname()
        };
      })
      .filter(share => share !== null);
  }

  /**
   * @param {SambaShare} share
   * @returns {Promise.<RbdMountPoint>}
   * @private
   */
  async _mount(share) {
    return await this.rbd.mount({
      image: share.image,
      pool: share.pool,
      readonly: false,
      permanent: true,
      id: share.id
    });
  }

  /**
   * @returns {Promise.<Array.<SambaShare>>}
   */
  async ls() {
    const result = this._parseShares(await this._readConfig());

    for (let share of result) {
      try {
        const lastSaved = JSON.parse(await this._db.get(`samba:share:${share.name}`));
        share = Object.assign(share, lastSaved);
      }
      catch (err) {
      }

      const info = await this.rbd.info({image: share.image, pool: share.pool, id: share.id});

      share.capacity = info.diskSize;
      share.used = info.diskUsed;
    }

    return result;
  }

  /**
   * @param {SambaShare} share
   * @returns {Promise.<SambaShare>}
   */
  async add(share) {
    let config = await this._readConfig();
    let prevShare = (this._parseShares(config))
      .filter(x => x.name.toLowerCase() === share.name.toLowerCase())[0];

    if (prevShare) {
      const newName = ImageNameParser.parse(share.image, share.pool);
      const prevName = ImageNameParser.parse(prevShare.image, prevShare.pool);

      if (prevName.fullName !== newName.fullName) {
        await this.rbd.umount({image: prevShare.image, pool: prevShare.pool, id: prevShare.id});
      }

      delete config[prevShare.name];
    }

    const mountPoint = await this._mount(share);
    await this._enableSeLinuxOnPath(mountPoint.location);

    for (const [user, password] of Object.entries(share.acl).map(([user, acl]) => [user, acl.password])) {
      await this._ensureUser(user);
      await this._passwd(user, password || '');
    }

    config = Object.assign(config, this._generateSambaConfig(share));

    if ('global' in config) {
      config['global']['map to guest'] = 'bad user';
      config['global']['dns proxy'] = 'no';
    }

    await this._writeConfig(config);
    await this._restartSamba();

    share.capacity = mountPoint.diskSize;
    share.used = mountPoint.diskUsed;
    share.host = os.hostname();

    await this._db.put(`samba:share:${share.name}`, JSON.stringify(share));

    return share;
  }

  /**
   *
   * @param {string} shareName
   * @returns {Promise.<boolean>}
   */
  async del(shareName) {
    let config = await this._readConfig();
    let share = (this._parseShares(config))
      .filter(x => x.name.toLowerCase() === shareName)[0];;

    if (share) {
      await this.rbd.umount({image: share.image, pool: share.pool, id: share.id, force: true});
      delete config[shareName];
      await this._writeConfig(config);
      await this._restartSamba();
      await this._db.del(`samba:share:${shareName}`);

      return true;
    }
    else {
      return false;
    }
  }

  /**
   * @param {string} shareName
   * @returns {Promise.<SambaShare>}
   * @private
   */
  async _getShareByName(shareName) {
    shareName = shareName.toLowerCase();

    let share = (this._parseShares(await this._readConfig()))
      .filter(x => x.name.toLowerCase() === shareName)[0];

    if (!share) {
      throw new Error(`samba share not found: ${shareName}`);
    }

    try {
      const lastSaved = JSON.parse(await this._db.get(`samba:share:${share.name}`));
      share = Object.assign(share, lastSaved);
    }
    catch (err) {
    }

    return share;
  }

  /**
   * @param {string} shareName
   * @param {string} username
   * @returns {Promise.<SambaAcl>}
   * @private
   */
  async _getUser(shareName, username) {
    const share = await this._getShareByName(shareName);

    if (!(username in share.acl)) {
      throw new Error(`samba user "${username}" not found in share "${shareName}"`);
    }

    return share.acl[username];
  }

  /**
   * @param {string} shareName
   * @param {string} username
   * @param {SambaAcl} acl
   * @returns {Promise.<boolean>}
   */
  async addUser(shareName, username, acl) {
    const share = await this._getShareByName(shareName);
    share.acl[username] = acl;
    await this.add(share);

    return true;
  }

  async delUser(shareName, username) {
    const share = await this._getShareByName(shareName);

    if (username in share.acl) {
      delete share.acl[username];
      await this.add(share);

      return true;
    }
    else {
      return false;
    }
  }

  /**
   * @param {string} shareName
   * @param {string} username
   * @param {SambaAcl} acl
   * @returns {Promise.<boolean>}
   */
  async editUser(shareName, username, acl) {
    try {
      const prevAcl = await this._getUser(shareName, username);
      Object.entries(acl).forEach(([key, value]) => prevAcl[key] = value);
      acl = prevAcl;
    }
    catch (err) {
    }

    return await this.addUser(shareName, username, acl);
  }

  /**
   * @param {SambaShare} share
   * @returns {Promise.<boolean>}
   */
  async update(share) {
    try {
      const prevShare = await this._getShareByName(share.name);

      Object.entries(share)
        .filter(([key]) => key !== 'acl')
        .forEach(([key, value]) => prevShare[key] = value);

      if ('acl' in share) {
        prevShare.acl = Object.assign(prevShare.acl, share.acl);
      }

      share = prevShare;
    }
    catch (err) {
    }

    await this.add(share);
    return true;
  }

  /**
   * @param {string} shareName
   * @param {string} newName
   * @returns {Promise.<boolean>}
   */
  async rename(shareName, newName) {
    const share = await this._getShareByName(shareName);
    await this.del(shareName);
    share.name = newName;
    await this.add(share);

    return true;
  }

  /**
   * @param {string} shareName
   * @param {number} size
   * @returns {Promise.<boolean>}
   */
  async extend(shareName, size) {
    const share = await this._getShareByName(shareName);
    await this.del(shareName);

    try {
      await this.rbd.extend({
        image: share.image,
        pool: share.pool,
        id: share.id,
        size: size
      });
    }
    catch (err) {
      await this.add(share);
      throw err;
    }

    await this.add(share);

    return true;
  }
}

module.exports = SambaClient;
