"use strict";

const Shell = require('../utils/Shell');
const SizeParser = require('../utils/SizeParser');
const ImageNameParser = require('../utils/ImageNameParser');
const RbdClient = require('../rbd');
const NumberPadder = require('../utils/NumberPadder');
const path = require('path');

/**
 * @typedef {object} IScsiLunList
 * @property {Array.<Number>} sizes
 * @property {string} image
 * @property {string} pool
 * @property {number|null} capacity
 * @property {number|null} used
 */

class IScsiClient {
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

    if (!/o-\s+fileio\s*\.*\s*\[Storage Objects:\s*\d+]/.test(lines[0])) {
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

    const index = name.indexOf('_');

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
        if (`${path.basename(item.path)}.img` !== item.name) {
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

        const sorted = [];

        for (let i = 0; i < items.length; i++) {
          if (items[i].index === i) {
            sorted.push(items[i]);
          }
          else {
            break;
          }
        }

        if (sorted.length < 1) {
          return [name, null];
        }
        else {
          return [name, {
            image: sorted[0].image,
            pool: sorted[0].pool,
            capacity: null,
            used: null,
            sizes: sorted.map(x => x.size)
          }];
        }
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
   * @param {string} name
   * @param {IScsiLunList} lunList
   * @param {number} size
   * @returns {Promise.<IScsiLunList>}
   * @private
   */
  async _addBackStore(name, lunList, size) {
    lunList = await this._ensureUsage(lunList);
    const available = lunList.capacity - lunList.sizes.reduce((prev, cur) => prev + cur, 0);

    if (size > available) {
      throw new Error(`can not create backstore for ${name} in image ${lunList.pool}/${lunList.image}` +
        ` with size ${SizeParser.stringify(size)} which exceeds ` +
        `renamining size of ${SizeParser.stringify(available)}`);
    }

    const diskName = this._createDiskName(name, lunList.sizes.length);
    const path = `${this.rbd.generateAutoMountPath({image: lunList.image, pool: lunList.pool})}/${diskName}.img`;

    await Shell.exec('targetcli', `"/backstores/fileio create ${diskName} ${path} ${SizeParser.stringify(size)}"`);

    const backStores = await this._lsBackStores();

    if (!(name in backStores)) {
      throw new Error(`could not re-find created backstore for ${name} in image ${lunList.pool}/${lunList.image}`);
    }

    return backStores[name];
  }
}

module.exports = IScsiClient;
