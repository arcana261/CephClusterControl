"use strict";

const Shell = require('../utils/Shell');
const CephClient = require('../ceph');
const log = require('logging').default('RbdClient');
const UTCClock = require('utc-clock');
const ErrorFormatter = require('../utils/ErrorFormatter');
const ImageNameParser = require('../utils/ImageNameParser');
const SizeParser = require('../utils/SizeParser');

class RbdClient {
  /**
   * @param {{db: *}} opts
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
   * format: Number, features: Array.<String>, flags: Array.<String>}>}
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

    return {
      image: name.fullName,
      size: size,
      objectCount: objectCount,
      order: order,
      objectSize: objectSize,
      blockNamePrefix: 'block_name_prefix' in rest ? rest['block_name_prefix'] : null,
      format: 'format' in rest ? parseInt(rest['format']) : null,
      features: 'features' in rest ? rest['features'].split(/[\s,]+/) : [],
      flags: 'flags' in rest ? rest['flags'].split(/[\s,]+/) : []
    };
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
   * @returns {Promise.<Array.<{
   * image: String, id: Number, snap: String, device: String
   * }>>}
   */
  async showMapped({id = 'admin'} = {}) {
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

      return {
        image: `${values[imageHeader]}/${values[poolHeader]}`,
        id: parseInt(values[idHeader]),
        snap: values[snapHeader],
        device: values[deviceHeader]
      };
    });
  }
}

module.exports = RbdClient;
