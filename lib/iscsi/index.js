"use strict";

const Shell = require('../utils/Shell');
const SizeParser = require('../utils/SizeParser');
const ImageNameParser = require('../utils/ImageNameParser');
const RbdClient = require('../rbd');
const NumberPadder = require('../utils/NumberPadder');
const path = require('path');
const fs = require('mz/fs');
const log = require('logging').default('IScsiClient');
const ErrorFormatter = require('../utils/ErrorFormatter');
const os = require('os');
const PackageJson = require('../../package.json');
const Ethernets = require('../utils/Ethernets');
const Distro = require('../utils/Distro');
const MkDir = require('../utils/MkDir');
const IScsiUtils = require('../utils/IScsiUtils');

/**
 * @typedef {object} IScsiWorkerInfoResponseItem
 * @property {Array.<string>} types
 * @property {string} hostname
 * @property {string} version
 * @property {Array.<string>} ip
 * @property {IScsiAuthentication|null} discovery
 * @property {DistroObject} distro
 */

/**
 * @typedef {Array.<IScsiWorkerInfoResponseItem>} IScsiWorkerInfoResponse
 */

/**
 * @typedef {object} IScsiLun
 * @property {number} size
 * @property {number} index
 */

/**
 * @typedef {object} IScsiLunList
 * @property {Array.<IScsiLun>} items
 * @property {string} image
 * @property {string} pool
 * @property {number|null} capacity
 * @property {number|null} used
 */

/**
 * @typedef {object} IScsiAuthentication
 * @property {string} userId
 * @property {string} password
 */

/**
 * @typedef {object} IScsiTarget
 * @property {IScsiIqn} iqn
 * @property {string} stringifiedIqn
 * @property {IScsiAuthentication|null} authentication
 * @property {IScsiLunList|null} luns
 * @property {string|null} host
 */

class IScsiClient {
  /**
   * @returns {Promise.<boolean>}
   */
  static async capable() {
    try {
      if (!(await RbdClient.capable())) {
        return false;
      }

      await Shell.exec('targetcli', '"ls / 1"');

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
   * @returns {Promise.<Array.<{name: string, path: string, size: number}>>}
   * @private
   */
  async _parseBackStores() {
    const shellResponse = await Shell.exec('targetcli', '"ls /backstores/fileio 1"');
    const lines = shellResponse.split('\n').map(x => x.trim()).filter(x => x.length > 0);

    if (lines.length < 1) {
      throw new Error(`can not parse targetcli response: ${shellResponse}`);
    }

    if (!/^\s*o-\s+fileio\s*\.*\s*\[Storage Objects:\s*\d+]\s*$/.test(lines[0])) {
      throw new Error(`could not parse first line from response: ${line[0]}`);
    }

    return lines.slice(1).map(line => {
      if (!line.startsWith('o-')) {
        throw new Error(`could not parse line: ${line}`);
      }

      line = line.substr('o-'.length).trim();

      let index = line.indexOf(' ');

      if (index < 0) {
        throw new Error(`could not parse line: ${line}`);
      }

      const name = line.substr(0, index).trim();
      line = line.substr(index + 1).trim();

      index = line.indexOf('[');

      if (index < 0) {
        throw new Error(`could not parse line: ${line}`);
      }

      line = line.substr(index + 1).trim();

      const parts = line.split(' ', 2);

      if (parts.length !== 2) {
        throw new Error(`could not parse line: ${line}`);
      }

      if (!parts[1].startsWith('(') || !parts[1].endsWith(')')) {
        throw new Error(`could not parse line: ${line}`);
      }

      if (!/^(\/[^ \/])+\/?/.test(parts[0])) {
        throw new Error(`could not parse line: ${line}`);
      }

      return {
        name: name,
        path: parts[0],
        size: SizeParser.parseMegabyte(parts[1].substr(1, parts[1].length - 2))
      };
    });
  }

  /**
   * @param {string} name
   * @param {number} index
   * @returns {string}
   * @private
   */
  _createDiskName(name, index) {
    return `automap_${name}_${NumberPadder.pad(index, 4)}`;
  }

  /**
   * @param {string} name
   * @returns {{name: string, index: number}}
   * @private
   */
  _parseDiskName(name) {
    const orig = name;
    name = name.trim();

    if (!name.startsWith('automap_')) {
      throw new Error(`syntax error: "${orig}"`);
    }

    name = name.substr('automap_'.length);

    const index = name.lastIndexOf('_');

    if (index < 0) {
      throw new Error(`syntax error: "${orig}"`);
    }

    const n = name.substr(index + 1);
    name = name.substr(0, index);

    if (!/\d{4}/.test(n)) {
      throw new Error(`syntax error: "${orig}"`);
    }

    return {
      name: name,
      index: parseInt(n)
    };
  }

  /**
   * @returns {Promise.<Object.<string, IScsiLunList>>}
   * @private
   */
  async _lsBackStores() {
    const items = (await this._parseBackStores())
      .map(item => {
        if (path.basename(item.path) !== `${item.name}.img`) {
          return null;
        }

        try {
          const imageName = this.rbd.parseAutoMountPath(path.dirname(item.path));
          const parsedName = this._parseDiskName(item.name);

          return {
            name: parsedName.name,
            index: parsedName.index,
            pool: imageName.pool,
            image: imageName.image,
            size: item.size
          };
        }
        catch (err) {
          return null;
        }
      }).filter(x => x !== null)
      .reduce((prev, item) => Object.assign(prev, {
        [item.name]: (item.name in prev ? prev[item.name] : []).concat(item)
      }), {});

    return Object.entries(items)
      .filter(([name, items]) => items.length > 0)
      .map(([name, items]) => {
        items = items
          .filter(x => x.image === items[0].image && x.pool === items[0].pool)
          .sort((x, y) => x.index - y.index);

        return [name, {
          image: items[0].image,
          pool: items[0].pool,
          capacity: null,
          used: null,
          items: items.map(x => ({
            index: x.index,
            size: x.size
          }))
        }];

      }).filter(([name, value]) => value !== null)
      .reduce((prev, [name, value]) => Object.assign(prev, {
        [name]: value
      }), {});
  }

  /**
   * @param {IScsiLunList} lunList
   * @returns {Promise.<IScsiLunList>}
   * @private
   */
  async _resolveUsage(lunList) {
    const info = await this.rbd.info({
      image: lunList.image,
      pool: lunList.pool
    });

    lunList.capacity = info.diskSize;
    lunList.used = info.diskUsed;

    return lunList;
  }

  /**
   * @param {IScsiLunList} lunList
   * @returns {Promise.<IScsiLunList>}
   * @private
   */
  async _ensureUsage(lunList) {
    if (lunList.capacity === null || lunList.used === null) {
      return await this._resolveUsage(lunList);
    }
    else {
      return lunList;
    }
  }

  /**
   * @param {string} iqnStr
   * @param {boolean} destroyData
   * @returns {Promise.<void>}
   * @private
   */
  _deleteLastBackStore(iqnStr, destroyData) {
    return this._deleteBackStore(iqnStr, destroyData, -1, {last: true});
  }

  /**
   * @param {string} iqnStr
   * @param {boolean} destroyData
   * @param {number} index
   * @param {boolean} last
   * @returns {Promise.<void>}
   * @private
   */
  async _deleteBackStore(iqnStr, destroyData, index, {last = false} = {}) {
    const iqn = IScsiUtils.parseIqn(iqnStr);
    const luns = await this._lsBackStores();

    if (iqn.name in luns) {
      const lun = luns[iqn.name];

      if (!last && (index < 0 || index >= lun.items.length)) {
        throw new Error(`backstore index "${index}" is out of range: [0, ${lun.items.length})`);
      }

      if (lun.items.length > 0) {
        if (last) {
          index = lun.items.length - 1;
        }

        const diskName = this._createDiskName(iqn.name, lun.items[index].index);
        const targetLun = (await this._parseLuns(iqnStr)).filter(x => x.value === diskName);

        if (targetLun.length > 0) {
          await Shell.exec('targetcli', `"/iscsi/${iqnStr}/tpg1/luns delete ${targetLun[0].name}"`);
        }

        await Shell.exec('targetcli', `"/backstores/fileio delete ${diskName}"`);

        if (destroyData) {
          const imagePath = path.join(this.rbd.generateAutoMountPath({image: lun.image, pool: lun.pool}),
            `${diskName}.img`);

          await fs.unlink(imagePath);
        }
      }
    }
  }

  /**
   * @param {string} name
   * @param {string} image
   * @param {string} pool
   * @param {number} size
   * @returns {Promise.<IScsiLunList>}
   * @private
   */
  async _addBackStore(name, image, pool, size) {
    const luns = await this._lsBackStores();
    let lun = null;

    if (!(name in luns)) {
      lun = {
        items: [],
        image: image,
        pool: pool,
        capacity: null,
        used: null
      };
    }
    else {
      lun = luns[name];
    }

    const mountResult = await this.rbd.mount({
      image: lun.image,
      pool: lun.pool,
      permanent: true
    });

    try {
      lun = await this._ensureUsage(lun);
      const available = lun.capacity - lun.items.reduce((prev, cur) => prev + cur.size, 0);

      if (size > available) {
        throw new Error(`can not create backstore for ${name} in image ${lun.pool}/${lun.image}` +
          ` with size ${SizeParser.stringify(size)} which exceeds ` +
          `renamining size of ${SizeParser.stringify(available)}`);
      }

      const diskName = this._createDiskName(name,
        lun.items.length < 1 ? 0 : lun.items[lun.items.length - 1].index + 1);
      const path = `${this.rbd.generateAutoMountPath({image: lun.image, pool: lun.pool})}/${diskName}.img`;

      await Shell.exec('targetcli', `"/backstores/fileio create ${diskName} ${path} ${size}M"`);

      const backStores = await this._lsBackStores();

      if (!(name in backStores)) {
        throw new Error(`could not re-find created backstore for ${name} in image ${lun.pool}/${lun.image}`);
      }

      return Object.assign({}, backStores[name], {
        _hasMounted: mountResult._hasMounted,
        _hasMapped: mountResult._hasMapped
      });
    }
    catch (err) {
      if (mountResult._hasMounted || mountResult._hasMapped) {
        await this.rbd.umount({
          image: lun.image,
          pool: lun.pool
        });
      }

      throw err;
    }
  }

  /**
   * @returns {Promise.<Array.<{iqn: IScsiIqn, stringifiedIqn: string, tpg: Number}>>}
   * @private
   */
  async _parseTargets() {
    const shellResponse = await Shell.exec('targetcli', '"ls /iscsi 1"');
    const lines = shellResponse.split('\n').map(x => x.trim()).filter(x => x.length > 0);

    if (lines.length < 1) {
      throw new Error(`can not parse targetcli response: ${shellResponse}`);
    }

    if (!/^\s*o-\s+iscsi\s*\.*\s*\[(\d+-way disc auth,\s*)?Targets:\s*\d+]\s*$/.test(lines[0])) {
      throw new Error(`could not parse first line from response: ${lines[0]}`);
    }

    return lines.slice(1).map(line => {
      if (!line.startsWith('o-')) {
        throw new Error(`could not parse line: ${line}`);
      }

      line = line.substr('o-'.length).trim();

      let index = line.indexOf(' ');

      if (index < 0) {
        throw new Error(`could not parse line: ${line}`);
      }

      const namePart = line.substr(0, index).trim();
      line = line.substr(index + 1).trim();

      index = line.indexOf('[');

      if (index < 0) {
        throw new Error(`could not parse line: ${line}`);
      }

      line = line.substr(index + 1).trim();

      const parts = line.split(/\s+/, 2);

      if (parts[0] !== 'TPGs:') {
        throw new Error(`expected TPG in line ${line}`);
      }

      if (!parts[1].endsWith(']')) {
        throw new Error(`bad TPG declaration in line ${line}`);
      }

      parts[1] = parts[1].substr(0, parts[1].length - 1).trim();

      if (!/^\d+$/.test(parts[1])) {
        throw new Error(`expected TPG count in line ${line}`);
      }

      const tpgCount = parseInt(parts[1]);

      return {
        iqn: IScsiUtils.parseIqn(namePart),
        stringifiedIqn: namePart,
        tpg: tpgCount
      }
    });
  }

  /**
   * @param {Object.<string, IScsiLunList>} backstores
   * @param {{iqn: IScsiIqn, stringifiedIqn: string, tpg: Number}} item
   * @param {boolean} usage
   * @returns {Promise.<IScsiTarget>}
   * @private
   */
  async _convertParsedTargetItem(backstores, item, {usage = true} = {}) {
    if (item.tpg !== 1) {
      return null;
    }
    else {
      const auth = await this._getTpgParam(item.stringifiedIqn, 'attribute', 'authentication');
      const userId = await this._getTpgParam(item.stringifiedIqn, 'auth', 'userid');
      const password = await this._getTpgParam(item.stringifiedIqn, 'auth', 'password');

      let authentication = null;
      let luns = null;

      if (auth === 1 || auth === '1') {
        authentication = {
          userId: userId,
          password: password
        };
      }

      if (item.iqn.name in backstores) {
        luns = await this._ensureUsage(backstores[item.iqn.name]);
      }

      return {
        iqn: item.iqn,
        stringifiedIqn: item.stringifiedIqn,
        authentication: authentication,
        luns: luns,
        host: os.hostname()
      };
    }
  }

  /**
   * @param {Array.<string>} filter
   * @param {boolean} usage
   * @returns {Promise.<Array.<IScsiTarget>>}
   */
  async ls({filter = [], usage = true} = {}) {
    const hasFilter = (filter instanceof Array) && filter.length > 0;
    const backstores = await this._lsBackStores();

    return (await Promise.all(
      (await this._parseTargets())
        .map(x => {
          if (!hasFilter || filter.indexOf(x.iqn.name) >= 0) {
            return this._convertParsedTargetItem(backstores, x, {usage: usage});
          }
          else {
            return null;
          }
        })
    )).filter(x => x !== null);
  }

  /**
   * @param {string} name
   * @returns {Promise.<IScsiTarget>}
   * @private
   */
  async _findTargetByName(name) {
    name = name.toLowerCase();
    const backstores = await this._lsBackStores();
    let result = (await this._parseTargets()).filter(x => x.iqn.name.toLowerCase() === name)[0];

    if (!result) {
      throw new Error(`target not found: "${name}"`);
    }

    result = await this._convertParsedTargetItem(backstores, result);

    if (!result) {
      throw new Error(`target not found: "${name}"`);
    }

    return result;
  }

  /**
   * @param {string} name
   * @returns {Promise.<boolean>}
   * @private
   */
  async _exists(name) {
    try {
      await this._findTargetByName(name);
      return true;
    }
    catch (err) {
      return false;
    }
  }

  /**
   * @param {string} iqnStr
   * @returns {Promise.<Array.<{name: string, value: string}>>}
   * @private
   */
  async _parseLuns(iqnStr) {
    const shellResponse = await Shell.exec('targetcli', `"ls /iscsi/${iqnStr}/tpg1/luns 1"`);
    const lines = shellResponse.split('\n').map(x => x.trim()).filter(x => x.length > 0);

    if (lines.length < 1) {
      throw new Error(`can not parse targetcli response: ${shellResponse}`);
    }

    if (!/^\s*o-\s+luns\s*\.*\s*\[LUNs:\s*\d+]\s*$/.test(lines[0])) {
      throw new Error(`could not parse first line from response: ${line[0]}`);
    }

    return lines.slice(1).map(line => {
      if (!line.startsWith('o-')) {
        throw new Error(`could not parse line: ${line}`);
      }

      line = line.substr('o-'.length).trim();

      let index = line.indexOf(' ');

      if (index < 0) {
        throw new Error(`could not parse line: ${line}`);
      }

      const namePart = line.substr(0, index).trim();
      line = line.substr(index + 1).trim();

      index = line.indexOf('[');

      if (index < 0) {
        throw new Error(`could not parse line: ${line}`);
      }

      line = line.substr(index + 1);

      index = line.indexOf(' ');

      if (index < 0) {
        throw new Error(`could not parse line: ${line}`);
      }

      line = line.substr(0, index);

      index = line.indexOf('/');

      if (index < 0) {
        throw new Error(`could not parse line: ${line}`);
      }

      const type = line.substr(0, index);
      const value = line.substr(index + 1);

      if (type !== 'fileio') {
        throw new Error(`expected lun type fileio: ${line}`);
      }

      return {
        name: namePart.replace(/^lun/g, ''),
        value: value
      };
    });
  }

  /**
   * @param {IScsiIqn} iqn
   * @param {string} iqnStr
   * @returns {Promise.<void>}
   * @private
   */
  async _ensureLuns(iqn, iqnStr) {
    const backStores = await this._lsBackStores();
    let expected = [];

    if (iqn.name in backStores) {
      expected = backStores[iqn.name].items.map(item => this._createDiskName(iqn.name, item.index));
    }

    const actual = (await this._parseLuns(iqnStr)).map(x => x.value);
    const diff = expected.filter(x => actual.indexOf(x) < 0);

    for (const disk of diff) {
      await Shell.exec('targetcli', `"/iscsi/${iqnStr}/tpg1/luns create /backstores/fileio/${disk}"`)
    }
  }

  /**
   * @param {string} path
   * @param {string} section
   * @param {string} key
   * @returns {Promise.<string>}
   * @private
   */
  async _getParam(path, section, key) {
    const shellResponse = (await Shell.exec('targetcli', `"${path} get ${section} ${key}"`)).trim();

    let index = shellResponse.indexOf('=');

    if (index < 0 || shellResponse.substr(0, index) !== key) {
      throw new Error(`failed to get tpgparam from line ${shellResponse}`);
    }

    return shellResponse.substr(index + 1).trim();
  }

  /**
   * @param {string} iqnStr
   * @param {string} section
   * @param {string} key
   * @returns {Promise.<string>}
   * @private
   */
  _getTpgParam(iqnStr, section, key) {
    return this._getParam(`/iscsi/${iqnStr}/tpg1`, section, key);
  }

  /**
   * @param {string} name
   * @param {string|null} host
   * @param {string|null} domain
   * @param {string} image
   * @param {string|null} pool
   * @param {number} size
   * @returns {Promise.<IScsiTarget>}
   */
  async add({name, host = null, domain = null, image, pool = '*', size} = {}) {
    if ((await this._exists(name))) {
      throw new Error(`iscsi target exists: ${name}`);
    }

    const now = new Date();
    const iqn = {
      year: now.getFullYear(),
      month: now.getMonth(),
      name: name,
      host: host,
      domain: domain,
      tag: 'target00'
    };
    const iqnStr = IScsiUtils.stringifyIqn(iqn);

    const backStoreResult = await this._addBackStore(name, image, pool, size);

    try {
      await Shell.exec('targetcli', `"/iscsi create ${iqnStr}"`);

      try {
        await this._ensureLuns(iqn, iqnStr);
        await Shell.exec('targetcli', `"/iscsi/${iqnStr}/tpg1/acls create ${iqnStr}"`);
        await Shell.exec('targetcli', `"/iscsi/${iqnStr}/tpg1/acls/${iqnStr} set auth userid=${iqnStr}"`);
        await Shell.exec('targetcli', `"/iscsi/${iqnStr}/tpg1/acls/${iqnStr} set auth password=1234"`);
        await Shell.exec('targetcli', `"/iscsi/${iqnStr}/tpg1 set attribute authentication=0"`);
        await Shell.exec('targetcli', `"/iscsi/${iqnStr}/tpg1 set attribute generate_node_acls=1"`);
        await Shell.exec('targetcli', `"/iscsi/${iqnStr}/tpg1 set attribute demo_mode_write_protect=0"`);
      }
      catch (err) {
        await Shell.exec('targetcli', `"/iscsi delete ${iqnStr}"`);
        throw err;
      }
    }
    catch (err) {
      await this._deleteLastBackStore(iqnStr, true);

      if (backStoreResult._hasMounted || backStoreResult._hasMapped) {
        await this.rbd.umount({image: image, pool: pool});
      }

      throw err;
    }

    return await this._findTargetByName(name);
  }

  /**
   * @param {string} password
   * @private
   */
  _assertPassword(password) {
    if (password.length !== 12 || password.includes('/') || password.includes('\\') || password.includes('!')) {
      throw new Error(`password should be 12 characters long, and it should not include` +
        ` any of characters [/,\\,!] but provided password was "${password}"`);
    }
  }

  /**
   * @returns {Promise.<void>}
   * @private
   */
  async _restartTarget() {
    await Shell.exec('systemctl', 'restart', 'target.service');
  }

  /**
   * @returns {Promise.<void>}
   * @private
   */
  async _stopTarget() {
    await Shell.exec('systemctl', 'stop', 'target.service');
  }

  /**
   * @returns {Promise.<void>}
   */
  async postRbdMount() {
    await this._restartTarget();
  }

  /**
   * @returns {Promise.<void>}
   */
  preShutDown() {
    return this._stopTarget();
  }

  /**
   * @param {string} name
   * @param {string} password
   * @returns {Promise.<IScsiTarget>}
   */
  async enableAuthentication(name, password) {
    this._assertPassword(password);
    const target = await this._findTargetByName(name);

    if (target.authentication) {
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1 set auth password=${password}"`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1 set auth mutual_userid="`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1 set auth mutual_password="`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1/acls/${target.authentication.userId} set auth password=${password}"`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1/acls/${target.authentication.userId} set auth mutual_userid="`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1/acls/${target.authentication.userId} set auth mutual_password="`);
    }
    else {
      const userId = IScsiUtils.stringifyIqn(Object.assign({}, target.iqn, {
        tag: 'client00'
      }));

      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1 set attribute authentication=1"`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1 set auth userid=${userId}"`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1 set auth password=${password}"`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1 set auth mutual_userid="`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1 set auth mutual_password="`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1/acls create ${userId}"`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1/acls/${userId} set auth userid=${userId}"`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1/acls/${userId} set auth password=${password}"`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1/acls/${userId} set auth mutual_userid="`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1/acls/${userId} set auth mutual_password="`);
    }

    return await this._findTargetByName(name);
  }

  /**
   * @param {string} name
   * @returns {Promise.<IScsiTarget>}
   */
  async disableAuthentication(name) {
    const target = await this._findTargetByName(name);

    if (target.authentication) {
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1/acls delete ${target.authentication.userId}"`);
      await Shell.exec('targetcli', `"/iscsi/${target.stringifiedIqn}/tpg1 set attribute authentication=0"`);

      return await this._findTargetByName(name);
    }
    else {
      return target;
    }
  }

  /**
   * @param {string} name
   * @param {number} size
   * @returns {Promise.<IScsiTarget>}
   */
  async addLun(name, size) {
    const target = await this._findTargetByName(name);

    if (!target.luns) {
      throw new Error(`no valid rbd-based luns found for target "${name}"`);
    }

    await this._addBackStore(name, target.luns.image, target.luns.pool, size);

    try {
      await this._ensureLuns(target.iqn, target.stringifiedIqn);
      return await this._findTargetByName(name);
    }
    catch (err) {
      await this._deleteLastBackStore(target.stringifiedIqn, true);
      throw err;
    }
  }

  /**
   * @param {string} name
   * @param {number} index
   * @param {boolean} destroyData
   * @returns {Promise.<IScsiTarget>}
   */
  async removeLun(name, index, {destroyData = false} = {}) {
    const target = await this._findTargetByName(name);

    if (!target.luns) {
      throw new Error(`no valid rbd-based luns found for target "${name}"`);
    }

    await this._deleteBackStore(target.stringifiedIqn, destroyData, index);
    await this._ensureLuns(target.iqn, target.stringifiedIqn);
    return await this._findTargetByName(name);
  }

  /**
   * @param {string} name
   * @param {boolean} destroyData
   * @returns {Promise.<boolean>}
   */
  async del(name, destroyData) {
    let target = await this._findTargetByName(name);
    let luns = target.luns;

    while (target.luns !== null && target.luns.sizes.length > 0) {
      for (let i = 0; i < target.luns.sizes.length; i++) {
        await this._deleteLastBackStore(target.stringifiedIqn, destroyData);
      }

      target = await this._findTargetByName(name);
    }

    await Shell.exec('targetcli', `"/iscsi delete ${target.stringifiedIqn}"`);

    if (luns !== null) {
      await this.rbd.umount({
        image: luns.image,
        pool: luns.pool
      });
    }

    return true;
  }

  /**
   * @param {string} dir
   * @returns {Promise.<void>}
   * @private
   */
  async _backupConfig(dir) {
    const now = new Date();
    const fileName = path.join(dir,
      `saveconfig-${now.getFullYear()}-${NumberPadder.pad(now.getMonth() + 1, 2)}-` +
      `${NumberPadder.pad(now.getDate(), 2)}-${NumberPadder.pad(now.getHours(), 2)}-` +
      `${NumberPadder.pad(now.getMinutes(), 2)}-${NumberPadder.pad(now.getSeconds(), 2)}.json`);

    await Shell.exec('cp', '-f', '/etc/target/saveconfig.json', fileName);
  }

  /**
   * @param {string} dir
   * @param {number} keepMax
   * @returns {Promise.<void>}
   */
  async performBackup(dir, keepMax) {
    await MkDir.path(dir);

    const list = (await fs.readdir(dir))
      .map(x => x.replace(/\..*$/g, '').split('-').slice(1))
      .filter(x => x.length === 6)
      .map(x => x.map(y => parseInt(y)))
      .sort((x, y) => {
        for (let i = 0; i < 6; i++) {
          if (x[i] < y[i]) {
            return -1;
          }
          else if (y[i] < x[i]) {
            return 1;
          }
        }

        return 0;
      });

    const take = Math.min(list.length, Math.max(0, (list.length + 1) - keepMax));

    for (let i = 0; i < take; i++) {
      const [year, month, day, hour, minute, second] = list[i];
      const fileName = 'saveconfig-' [NumberPadder.pad(year, 4), NumberPadder.pad(month, 2),
        NumberPadder.pad(day, 2), NumberPadder.pad(hour, 2), NumberPadder.pad(minute, 2),
        NumberPadder.pad(second, 2)].join('-') + '.json';

      await fs.unlink(path.join(dir, fileName));
    }

    await this._backupConfig(dir);
  }

  /**
   * @param {string} name
   * @param {string} newName
   * @returns {Promise.<IScsiTarget>}
   */
  async rename(name, newName) {
    const target = await this._findTargetByName(name);

    if (target.luns === null || target.luns.sizes.length < 1) {
      throw new Error(`specified target ${name} does not have rbd compatible luns`);
    }

    if (!(await this.del(name, false))) {
      throw new Error(`failed to delete target ${name}`);
    }

    const mountResult = await this.rbd.mount({
      image: target.luns.image,
      pool: target.luns.pool,
      permanent: true
    });

    try {
      const directory = this.rbd.generateAutoMountPath({
        image: target.luns.image,
        pool: target.luns.pool
      });

      for (let i = 0; i < target.luns.sizes.length; i++) {
        await fs.rename(
          path.join(directory, `${this._createDiskName(name, i)}.img`),
          path.join(directory, `${this._createDiskName(newName, i)}.img`));
      }

      let newTarget = await this.create({
        name: newName,
        host: target.iqn.host,
        domain: target.iqn.domain,
        image: target.luns.image,
        pool: target.luns.pool,
        size: target.luns.sizes[0]
      });

      for (const size of target.luns.sizes.slice(1)) {
        newTarget = await this.addLun(newName, size);
      }

      if (target.authentication !== null) {
        newTarget = await this.enableAuthentication(newName, target.authentication.password);
      }

      return newTarget;
    }
    catch (err) {
      if (mountResult._hasMapped || mountResult._hasMounted) {
        await this.rbd.umount({image: target.luns.image, pool: target.luns.pool});
      }

      throw err;
    }
  }

  /**
   * @param {string} name
   * @param {number} size
   * @returns {Promise.<IScsiTarget>}
   */
  async extend(name, size) {
    const target = await this._findTargetByName(name);

    if (!target.luns) {
      throw new Error(`no valid rbd-based luns found for target "${name}"`);
    }

    await this.rbd.extend({
      image: target.luns.image,
      pool: target.luns.pool,
      id: 'admin',
      size: size
    });

    return await this._findTargetByName(name);
  }

  /**
   * @returns {Promise.<IScsiAuthentication|null>}
   */
  async getDiscoveryAuthentication() {
    const enabledStr = await this._getParam('/iscsi', 'discovery_auth', 'enable');
    const enabled = enabledStr === 1 || enabledStr === '1' || enabledStr.toLowerCase() === 'true';

    if (enabled) {
      return {
        userId: await this._getParam('/iscsi', 'discovery_auth', 'userid'),
        password: await this._getParam('/iscsi', 'discovery_auth', 'password')
      };
    }
    else {
      return null;
    }
  }

  /**
   * @param {string} host
   * @param {string} domain
   * @param {string} password
   * @returns {Promise.<boolean>}
   */
  async enableDiscoveryAuthentication(host, domain, password) {
    this._assertPassword(password);

    const enabledStr = await this._getParam('/iscsi', 'discovery_auth', 'enable');
    const enabled = enabledStr === 1 || enabledStr === '1' || enabledStr.toLowerCase() === 'true';

    if (enabled) {
      await Shell.exec('targetcli', `"/iscsi set discovery_auth password=${password}"`);
    }
    else {
      const now = new Date();
      const iqn = IScsiUtils.stringifyIqn({
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        name: 'discovery',
        host: host,
        domain: domain,
        tag: 'discovery00'
      });

      await Shell.exec('targetcli', `"/iscsi set discovery_auth enable=1"`);
      await Shell.exec('targetcli', `"/iscsi set discovery_auth userid=${iqn}"`);
      await Shell.exec('targetcli', `"/iscsi set discovery_auth password=${password}"`);
    }

    return true;
  }

  /**
   * @returns {Promise.<boolean>}
   */
  async disableDiscoveryAuthentication() {
    await Shell.exec('targetcli', `"/iscsi set discovery_auth enable=0"`);
    return true;
  }

  /**
   * @returns {Promise.<IScsiWorkerInfoResponseItem>}
   */
  async report() {
    let ethers = [];

    try {
      ethers = (await Ethernets.ls())
        .map(x => x.ipv4)
        .reduce((prev, cur) => prev.concat(cur), [])
        .map(x => x.address);
    }
    catch (err) {
      log.warn(ErrorFormatter.format(err));
    }

    return {
      types: [],
      hostname: os.hostname(),
      version: PackageJson.version,
      ip: ethers,
      discovery: await this.getDiscoveryAuthentication(),
      distro: await Distro.getDistro()
    };
  }
}

module.exports = IScsiClient;
