"use strict";

const Shell = require('../utils/Shell');
const CephClient = require('../ceph');
const log = require('logging').default('RbdClient');
const UTCClock = require('utc-clock');
const ErrorFormatter = require('../utils/ErrorFormatter');
const ImageNameParser = require('../utils/ImageNameParser');
const SizeParser = require('../utils/SizeParser');
const MkDir = require('../utils/MkDir');
const os = require('os');
const NumberPadder = require('../utils/NumberPadder');

/**
 * @typedef {object} RbdMountPoint
 * @property {string} location
 * @property {string} host
 * @property {number|null} diskSize
 * @property {number|null} diskUsed
 * @property {string|null} fileSystem
 * @property {number} rbdId
 * @property {string} device
 * @property {string} image
 * @property {boolean} readOnly
 */

class RbdClient {
  /**
   * @param {{db: LevelDb}} opts
   */
  constructor(opts) {
    this._db = opts.db;
    this._cephClient = new CephClient(opts);
  }

  /**
   * @returns {Promise.<boolean>}
   */
  static async capable() {
    try {
      if (!(await CephClient.capable())) {
        return false;
      }

      await (new RbdClient({})).ls({pool: 'rbd'});
      return true;
    }
    catch (err) {
      log.error(ErrorFormatter.format(err));
      return false;
    }
  }

  static async supportedFormatts() {
    const formatts = ['bfs', 'cramfs', 'ext2', 'ext3', 'ext4', 'ext4dev',
    'fat', 'minix', 'msdos', 'ntfs', 'vfat', 'xfs'];

    return (await Promise.all(formatts.map(async x => {
      try {
        await Shell.exec(`mkfs.${x}`, '--help');
        return {format: x, result: true};
      }
      catch (err) {
        try {
          await Shell.exec(`mkfs.${x}`, '-V');
          return {format: x, result: true};
        }
        catch (err2) {
          return {format: x, result: false};
        }
      }
    }))).filter(x => x.result).map(x => x.format);
  }

  /**
   * @returns {Promise.<Array.<String>>}
   */
  async ls({pool = '*', id = 'admin'} = {}) {
    if (pool !== '*') {
      return (await Shell.exec('rbd', 'ls', '-p', pool, '--id', id))
        .split('\n')
        .map(x => x.trim())
        .filter(x => x.length > 0)
        .map(x => `${pool}/${x}`);
    }
    else {
      return (await Promise.all((await this._cephClient.pool.ls())
        .map(x => this.ls({pool: x, id: id}))))
        .reduce((prev, cur) => prev.concat(cur), []);
    }
  }

  /**
   * @returns {Promise.<{known: Boolean, reason: String, provisioned: Number, used: Number, timestamp: Number}>}
   */
  async lastKnownDiskUsage({image, pool = '*', id = 'admin'} = {}) {
    try {
      let last = JSON.parse(await this._db.get(`rbd:du:${ImageNameParser.parse(image, pool).fullName}`));

      return {
        known: true,
        reason: null,
        provisioned: last.provisioned,
        used: last.used,
        timestamp: last.timestamp
      };
    }
    catch (err) {
      return {
        known: false,
        reason: ErrorFormatter.format(err),
        provisioned: 0,
        used: 0,
        timestamp: 0
      };
    }
  }

  /**
   * @returns {Promise.<{provisioned: Number, used: Number, timestamp: Number}>}
   */
  async updateDiskUsage({image, pool = '*', id = 'admin'} = {}) {
    const name = ImageNameParser.parse(image, pool);
    const shellResult = await Shell.exec('rbd', 'du', name.fullName, '--id', id);

    const result = shellResult.split('\n')
      .map(x => x.trim().split(' ').filter(y => y.length > 0))
      .filter(x => x.length === 3);

    if (result.length < 1) {
      throw new Error(`no usable result found in shell response: ${shellResult}`);
    }

    const header = result.filter(x => x.includes('NAME') && x.includes('PROVISIONED') && x.includes('USED'));

    if (header.length !== 1) {
      throw new Error(`header not found in shell response: ${shellResult}`);
    }

    const nameHeader = header[0].indexOf('NAME');
    const provisionedHeader = header[0].indexOf('PROVISIONED');
    const usedHeader = header[0].indexOf('USED');

    const usageReport = result.filter(x => x[nameHeader] === name.image ||
      x[nameHeader] === image || x[nameHeader] === name.fullName);

    if (usageReport.length !== 1) {
      throw new Error(`usage report not found in shell response: ${shellResult}`);
    }

    const report = {
      provisioned: SizeParser.parseMegabyte(usageReport[0][provisionedHeader]),
      used: SizeParser.parseMegabyte(usageReport[0][usedHeader]),
      timestamp: (new UTCClock()).now.ms()
    };

    await this._db.put(`rbd:du:${name.fullName}`, JSON.stringify(report));

    return report;
  }

  /**
   * @returns {Promise.<{image: String, size: Number, objectCount: Number, order: Number,
   * objectSize: Number, blockNamePrefix: String,
   * format: Number, features: Array.<String>, flags: Array.<String>,
   * diskSize: Number|null, diskUsed: Number|null, fileSystem: String|null}>}
   */
  async info({image, pool = '*', id = 'admin'} = {}) {
    const name = ImageNameParser.parse(image, pool);
    const shellResult = await Shell.exec('rbd', 'info', name.fullName, '--id', id);
    const lines = shellResult.split('\n').map(x => x.trim());

    if (lines.length < 4) {
      throw new Error(`output format error: ${shellResult}`);
    }

    if (!lines[0].startsWith('rbd image \'') || !lines[0].endsWith('\':')) {
      throw new Error(`output format error: ${shellResult}`);
    }

    let firstLine = lines[0].substr(lines[0].indexOf('\'') + 1);
    firstLine = firstLine.substr(0, firstLine.indexOf('\''));

    if (firstLine !== image && firstLine !== name.image && firstLine !== name.fullName) {
      throw new Error(`image ${image} not found: ${shellResult}`);
    }

    const sizeLine = lines[1].split(' ').filter(x => x.length > 0);

    if (sizeLine.length !== 6 || sizeLine[0] !== 'size' ||
      sizeLine[3] !== 'in' || sizeLine[5] !== 'objects' ||
      !/\d+/.test(sizeLine[1]) || !/\d+/.test(sizeLine[4])) {
      throw new Error(`failed to parse size line: ${shellResult}`);
    }

    const size = SizeParser.parseMegabyte(sizeLine[1] + ' ' + sizeLine[2]);
    const objectCount = parseInt(sizeLine[4]);

    const orderLine = lines[2].split(' ').filter(x => x.length > 0);

    if (orderLine.length !== 5 || orderLine[0] !== 'order' ||
      orderLine[4] !== 'objects)' || !/\d+/.test(orderLine[1]) ||
      !/\(\d+/.test(orderLine[2])) {
      throw new Error(`failed to parse order line: ${shellResult}`);
    }

    const order = parseInt(orderLine[1]);
    const objectSize = SizeParser.parseMegabyte(orderLine[2].substr(1) + ' ' + orderLine[3]);

    const rest = lines.slice(3).reduce((prev, cur) => Object.assign(prev, {
      [cur.substr(0, cur.indexOf(':'))]: cur.substr(cur.indexOf(':') + 1).trim()
    }), {});

    const mountResult = await this.mount({image: image, pool: pool, readonly: null, id: id});

    const ret = {
      image: name.fullName,
      size: size,
      diskSize: mountResult.diskSize,
      diskUsed: mountResult.diskUsed,
      fileSystem: mountResult.fileSystem,
      objectCount: objectCount,
      order: order,
      objectSize: objectSize,
      blockNamePrefix: 'block_name_prefix' in rest ? rest['block_name_prefix'] : null,
      format: 'format' in rest ? parseInt(rest['format']) : null,
      features: 'features' in rest ? rest['features'].split(/[\s,]+/) : [],
      flags: 'flags' in rest ? rest['flags'].split(/[\s,]+/) : []
    };

    await this._recycleMount(mountResult);

    return ret;
  }

  /**
   * @returns {Promise.<String>}
   */
  async create({image, size, pool = '*', format = 'xfs', formatOptions = '', id = 'admin'}) {
    const name = ImageNameParser.parse(image, pool);

    try {
      await Shell.exec('rbd', 'create', '-p', name.pool, '--id', id, '--size', size, name.image);
      await Shell.exec('rbd', 'map', name.fullName, '--id', id);
      await Shell.exec(`mkfs.${format}`, `/dev/rbd/${name.pool}/${name.image}`, formatOptions);
      await Shell.exec('rbd', 'unmap', name.fullName, '--id', id);

      return name.fullName;
    }
    catch (err) {
      try {
        await Shell.exec('rbd', 'unmap', name.fullName, '--id', id);
      }
      catch (ignore) {
        log.warn(ErrorFormatter.format(ignore));
      }

      try {
        await Shell.exec('rbd', 'rm', name.fullName, '--id', id);
      }
      catch (ignore) {
        log.warn(ErrorFormatter.format(ignore));
      }

      throw err;
    }
  }

  /**
   * @returns {Promise.<{
   * size: Number|null, used: Number|null, mountPoint: String|null, fileSystem: String|null
   * }>}
   * @private
   */
  async _getMountPoint(rbdId) {
    try {
      let shellResponse = (await Shell.exec(`df -h | grep rbd${rbdId}`)).trim();
      let fields = shellResponse.split(/\s+/);

      if (fields.length !== 6 || fields[0] !== `/dev/rbd${rbdId}`) {
        throw new Error(`can not read lsblk response: ${shellResponse}`);
      }

      shellResponse = (await Shell.exec('blkid', `/dev/rbd${rbdId}`)).trim();

      if (!shellResponse.startsWith(`/dev/rbd${rbdId}:`)) {
        throw new Error(`can not read blkid response: ${shellResponse}`);
      }

      const criteria = 'TYPE="';
      let index = shellResponse.indexOf(criteria);
      let fs = 'unknown';

      if (index >= 0) {
        let end = shellResponse.indexOf('"', index + criteria.length);

        if (end >= 0) {
          fs = shellResponse.substring(index + criteria.length, end);
        }
      }

      return {
        size: SizeParser.parseMegabyte(fields[1]),
        used: SizeParser.parseMegabyte(fields[2]),
        mountPoint: fields[5],
        fileSystem: fs
      };
    }
    catch (err) {
      return {
        size: null,
        used: null,
        mountPoint: null,
        fileSystem: null
      };
    }
  }

  /**
   * @returns {Promise.<Array.<{
   * image: String, rbdId: Number, snap: String, device: String,
   * }>>}
   * @private
   */
  async _getMappedShort({id = 'admin'} = {}) {
    const shellResult = await Shell.exec('rbd', 'showmapped', '--id', id);
    const lines = shellResult.split('\n').map(x => x.trim()).filter(x => x.length > 0);

    if (lines.length < 1) {
      return [];
    }

    const headerLine = lines[0].split(/\s+/).map(x => x.trim()).filter(x => x.length > 0);

    if (headerLine.length !== 5) {
      throw new Error(`failed to read header line: ${shellResult}`);
    }

    const idHeader = headerLine.indexOf('id');
    const poolHeader = headerLine.indexOf('pool');
    const imageHeader = headerLine.indexOf('image');
    const snapHeader = headerLine.indexOf('snap');
    const deviceHeader = headerLine.indexOf('device');

    if (idHeader < 0 || poolHeader < 0 || imageHeader < 0 ||
      snapHeader < 0 || deviceHeader < 0) {
      throw new Error(`failed to parse header line: ${shellResult}`);
    }

    return lines.slice(1).map(x => {
      const values = x.split(/\s+/).map(y => y.trim()).filter(y => y.length > 0);
      const rbdId = parseInt(values[idHeader]);

      return {
        image: `${values[poolHeader]}/${values[imageHeader]}`,
        rbdId: rbdId,
        snap: values[snapHeader],
        device: values[deviceHeader],
      };
    });
  }

  /**
   * @returns {Promise.<Array.<{
   * image: String, rbdId: Number, snap: String, device: String,
   * diskSize: Number|null, diskUsed: Number|null, mountPoint: String|null, fileSystem: String|null,
   * readOnly: Boolean
   * }>>}
   */
  async getMapped({id = 'admin'} = {}) {
    return await Promise.all((await this._getMappedShort({id: id})).map(async x => {
      const mount = await this._getMountPoint(x.rbdId);

      let lastReadOnly = false;

      try {
        let lastConfig = JSON.parse(await this._db.get(`rbd:mount:lastconfig:${name.fullName}`));
        lastReadOnly = lastConfig.readonly;
      }
      catch (err) {
      }

      return Object.assign(x, {
        diskSize: mount.size,
        diskUsed: mount.used,
        mountPoint: mount.mountPoint,
        fileSystem: mount.fileSystem,
        readOnly: lastReadOnly
      });
    }));
  }

  /**
   * @returns {Promise.<Number>}
   * @private
   */
  async _map({name, id = 'admin', readonly = false} = {}) {
    const result = (await Shell.exec('rbd', 'map', name.fullName, '--id', id, readonly ? '--read-only' : '')).trim();

    if (!result.startsWith('/dev/rbd')) {
      throw new Error(`unexpected command execution result: ${result}`);
    }

    return parseInt(result.substr('/dev/rbd'.length));
  }

  /**
   * @returns {Promise.<void>}
   * @private
   */
  async _unmap({name, id = 'admin'} = {}) {
    await Shell.exec('rbd', 'unmap', `/dev/rbd/${name.pool}/${name.image}`, '--id', id);
  }

  /**
   * @returns {Promise.<void>}
   * @private
   */
  async _mount({target, name} = {}) {
    await Shell.exec('mount', `/dev/rbd/${name.pool}/${name.image}`, target);
  }

  /**
   * @returns {Promise.<void>}
   * @private
   */
  async _umount(target) {
    await Shell.exec('umount', target);
  }

  /**
   * @returns {Promise.<{result: Boolean, mountPoint: String|null}>}
   */
  async umount({image, pool = '*', id = 'admin', force = false} = {}) {
    const name = ImageNameParser.parse(image, pool);

    let mapped = (await this._getMappedShort({id: id})).filter(x => x.image === name.fullName)[0];

    if (mapped) {
      let mountPoint = await this._getMountPoint(mapped.rbdId);

      if (mountPoint.mountPoint) {
        try {
          await this._umount(mountPoint.mountPoint);
        }
        catch (err) {
          if (force) {
            await Shell.exec('fuser', '-km', mountPoint.mountPoint);
            await this._umount(mountPoint.mountPoint);
          }
          else {
            throw err;
          }
        }
      }

      await this._unmap({name: name, id: id});

      return {
        result: true,
        mountPoint: mountPoint.mountPoint
      };
    }

    const multiSetKey = `rbd:automount:${NumberPadder.pad(name.fullName, 50)}`;
    await this._db.del(multiSetKey);

    return {
      result: false,
      mountPoint: null
    };
  }

  /**
   * @returns {Promise.<{host: String, mountPoints: Array.<{
   * image: String, location: String, device: String, rbdId: Number,
   * diskSize: Number|null, diskUsed: Number|null, fileSystem: String|null,
   * readOnly: Boolean
   * }>}>}
   */
  async automount() {
    const result = (await this._db.read({
      gte: `rbd:automount:${NumberPadder.pad('0', 50)}`,
      lte: `rbd:automount:${NumberPadder.pad('Z', 50, 'Z')}`
    })).map(x => JSON.parse(x.value));

    let mountPoints = [];

    for (const item of result) {
      log.info(`Trying to automount image ${item.image} on ${item.target} ${item.readonly ? 'as readonly ' : ''}` +
        ` using id ${item.id}`);

      try {
        const mountResult = await this.mount({
          image: item.image,
          target: item.target,
          readonly: item.readonly,
          id: item.id,
          permanent: true
        });

        log.info(`Successfuly mounted image ${item.image} on ${item.target}`);

        mountPoints.push({
          image: item.image,
          location: item.target,
          device: mountResult.device,
          rbdId: mountResult.rbdId,
          diskSize: mountResult.diskSize,
          diskUsed: mountResult.diskUsed,
          fileSystem: mountResult.fileSystem,
          readOnly: mountResult.readOnly
        });
      }
      catch (err) {
        log.error(`Failed to automount image ${item.image} on ${item.target} ` +
          `due to error ${ErrorFormatter.format(err)}`);
      }
    }

    return {
      host: os.hostname(),
      mountPoints: mountPoints
    };
  }

  /**
   * @returns {Promise.<void>}
   * @private
   */
  async _recycleMount({image, _id, _hasMounted, _recycleAsReadOnly} = {}) {
    if (_hasMounted) {
      if (_recycleAsReadOnly) {
        await this.mount({
          image: image,
          readonly: true,
          id: _id
        })
      }
      else {
        await this.umount({image: image, id: _id});
      }
    }
  }

  /**
   * @param {string} image
   * @param {string} pool
   * @returns {string}
   */
  generateAutoMountPath({image, pool = '*'}) {
    const name = ImageNameParser.parse(image, pool);
    return `/tmp/kaveh-automount/${name.pool}/${name.image}`;
  }

  /**
   * @param {string} path
   * @returns {ParsedImageName}
   */
  parseAutoMountPath(path) {
    if (!path.startsWith('/tmp/kaveh-automount/')) {
      throw new Error(`syntax error: ${path}`);
    }

    path = path.substr('/tmp/kaveh-automount/'.length);

    if (path.indexOf('/') < 0) {
      throw new Error(`syntax error: ${path}`);
    }

    return ImageNameParser.parse(path);
  }

  /**
   * @returns {Promise.<RbdMountPoint>}
   */
  async mount({image, pool = '*', target = '*', readonly = false, permanent = false, id = 'admin'} = {}) {
    const name = ImageNameParser.parse(image, pool);

    if (!target || target === '*') {
      target = this.generateAutoMountPath({image: image, pool: pool});
    }

    await MkDir.path(target);

    let mapped = (await this._getMappedShort({id: id})).filter(x => x.image === name.fullName)[0];

    let shouldMap = true;
    let shouldMount = true;
    let recycleAsReadOnly = false;
    let rbdId = null;

    if (mapped) {
      let lastReadOnly = false;

      try {
        let lastConfig = JSON.parse(await this._db.get(`rbd:mount:lastconfig:${name.fullName}`));
        lastReadOnly = lastConfig.readonly;
      }
      catch (err) {
      }

      const mountPoint = await this._getMountPoint(mapped.rbdId);

      if (readonly === null) {
        readonly = lastReadOnly;
      }

      if (readonly !== lastReadOnly) {
        if (mountPoint.mountPoint) {
          await this._umount(mountPoint.mountPoint);
        }

        await this._unmap({name: name, id: id});

        recycleAsReadOnly = lastReadOnly;
      }
      else {
        shouldMap = false;
        rbdId = mapped.rbdId;

        if (mountPoint.mountPoint && target !== mountPoint.mountPoint) {
          await this._umount(mountPoint.mountPoint);
        }
        else {
          shouldMount = false;
        }
      }
    }

    if (shouldMap) {
      rbdId = await this._map({name: name, id: id, readonly: readonly});
    }

    if (shouldMount) {
      await this._mount({name: name, target: target});
    }

    const mounted = await this._getMountPoint(rbdId);

    if (readonly === null) {
      readonly = false;
    }

    await this._db.put(`rbd:mount:lastconfig:${name.fullName}`, JSON.stringify({
      readonly: readonly
    }));

    if (permanent) {
      const valueToAdd = JSON.stringify({
        image: name.fullName,
        target: target,
        readonly: readonly,
        id: id
      });

      const multiSetKey = `rbd:automount:${NumberPadder.pad(name.fullName, 50)}`;
      await this._db.put(multiSetKey, valueToAdd);
    }

    return {
      location: target,
      host: os.hostname(),
      image: name.fullName,
      diskSize: mounted.size,
      diskUsed: mounted.used,
      fileSystem: mounted.fileSystem,
      rbdId: rbdId,
      device: `/dev/rbd${rbdId}`,
      _hasMapped: shouldMap,
      _hasMounted: shouldMount,
      _recycleAsReadOnly: recycleAsReadOnly,
      _id: id,
      readOnly: readonly
    };
  }

  /**
   * @returns {Promise.<Boolean>}
   */
  async rm({image, pool = '*', id = 'admin'} = {}) {
    const name = ImageNameParser.parse(image, pool);
    await Shell.exec('rbd', 'rm', name.fullName, '--id', id);

    return true;
  }

  /**
   * @returns {Promise.<Boolean>}
   */
  async extend({image, pool = '*', id = 'admin', size} = {}) {
    const name = ImageNameParser.parse(image, pool);
    const mountResult = await this.mount({image: image, pool: pool, readonly: false, id: id});

    const info = await this.info({image: image, pool: pool, id: id});

    if (!['xfs', 'ext4', 'ext3', 'ext2'].indexOf(info.fileSystem) < 0) {
      throw new Error(`Filesystem not Supported: ${info.fileSystem}`);
    }

    const newSize = info.size + size;
    await Shell.exec('rbd', 'resize', '--image', name.image, '--pool', name.pool, '--size', '' + newSize);

    if (info.fileSystem === 'xfs') {
      await Shell.exec('xfs_growfs', mountResult.location);
    }
    else {
      await Shell.exec('resize2fs', mountResult.location);
    }

    await this._recycleMount(mountResult);

    return true;
  }
}

module.exports = RbdClient;
