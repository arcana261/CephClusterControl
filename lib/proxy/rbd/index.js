"use strict";

const UnfoldBroadcast = require('../../utils/UnfoldBroadcast');
const ImageNameParser = require('../../utils/ImageNameParser');

class RbdProxy {
  /**
   * @param {ClientLoop} client
   */
  constructor (client) {
    this._client = client;
  }

  /**
   * @returns {ClientLoop}
   */
  get client() {
    return this._client;
  }

  /**
   * @returns {Promise.<WorkerInfoResponse>}
   */
  hosts() {
    return this._client.listHostsForType('rbd');
  }

  /**
   * @returns {Promise.<Array.<String>>}
   */
  ls({pool = 'rbd', id = 'admin'} = {}) {
    return this._client.enqueue('rbd', 'rbd.ls', [{
      pool: pool,
      id: id
    }]);
  }

  /**
   * @returns {Promise.<Array<{hostname: String, instanceId: String, provisioned: Number, used: Number, timestamp: Number}>>}
   */
  async lastKnownDiskUsage({image, pool = '*', id = 'admin'} = {}) {
    return UnfoldBroadcast.unfold(await this._client.broadcastType('rbd', 'rbd.lastKnownDiskUsage', [{
      image: image,
      id: id,
      pool: pool
    }])).filter(x => x.success && x.data.known)
      .map(x => ({
        hostname: x.hostname,
        instanceId: x.instanceId,
        provisioned: x.data.provisioned,
        used: x.data.used,
        timestamp: x.data.timestamp
      }));
  }

  /**
   * @returns {Promise.<{provisioned: Number, used: Number, timestamp: Number}>}
   */
  updateDiskUsage({image, pool = '*', id = 'admin', host = '*'} = {}) {
    const args = [{
      image: image,
      id: id,
      pool: pool
    }];

    if (!host || host === '*') {
      return this._client.enqueue('rbd', 'rbd.updateDiskUsage', args, {timeout: -1});
    }
    else {
      return this._client.call('rbd', host, 'rbd.updateDiskUsage', args, {timeout: -1});
    }
  }

  /**
   * @returns {Promise.<RbdImageInfo>}
   */
  info({image, pool = '*', id = 'admin', host = '*', timeout = 0} = {}) {
    const args = [{
      image: image,
      id: id,
      pool: pool
    }];

    if (!host || host === '*') {
      return this._client.enqueue('rbd', 'rbd.info', args, {timeout: timeout});
    }
    else {
      return this._client.call('rbd', host, 'rbd.info', args, {timeout: timeout});
    }
  }

  /**
   * @returns {Promise.<String>}
   */
  create({image, pool = '*', size, format = 'xfs', formatOptions = '', id = 'admin'}) {
    return this._client.enqueue(`rbd:${format}`, 'rbd.create', [{
      image: image,
      size: size,
      format: format,
      formatOptions: formatOptions,
      id: id,
      pool: pool
    }], {timeout: -1});
  }

  /**
   * @returns {Promise.<Array.<RbdMountPoint>>}
   */
  async getMapped({host = '*', id = 'admin'} = {}) {
    let result = null;

    if (!host || host === '*') {
      const hosts =  (await this.hosts()).map(x => x.hostname);
      result = await this._client.broadcastType('rbd', 'rbd.getMapped',
        [{id: id}], {timeout: -1, waitForHosts: hosts});
    }
    else {
      result = {
        [host]: {
          instance: {
            hostname: host,
            instance: 'instance',
            success: true,
            data: await this._client.call('rbd', host, 'rbd.getMapped', [{id: id}], {timeout: -1})
          }
        }
      };
    }

    result = UnfoldBroadcast.unfold(result).filter(x => x.success);

    const hosts = Array.from(new Set(result.map(x => x.hostname)));

    return hosts.map(x => {
      const instanceResult = result.filter(y => y.hostname === x)[0];

      return instanceResult.data.map(y => ({
        hostname: instanceResult.hostname,
        instanceId: instanceResult.instanceId,
        image: y.image,
        rbdId: y.rbdId,
        snap: y.snap,
        device: y.device,
        diskSize: y.diskSize,
        diskUsed: y.diskUsed,
        mountPoint: y.mountPoint,
        fileSystem: y.fileSystem
      }));
    }).reduce((prev, cur) => prev.concat(cur), []);
  }

  /**
   * @returns {Promise.<{location: String, host: String, diskSize: Number|null, diskUsed: Number|null,
    * fileSystem: String|null, image: String, rbdId: Number, device: String, readOnly: Boolean}>}
   */
  async mount({image, host = '*', pool = '*', target = '*', readonly = false,
          permanent = false, id = 'admin', fileSystem = '*'} = {}) {
    const name = ImageNameParser.parse(image, pool);
    const mappings = (await this.getMapped({id: id}))
      .filter(x => x.image === name.fullName && x.hostname !== host);

    if (mappings.length > 0) {
      const mapping = mappings[0];

      if (host === '*') {
        host = mapping.hostname;
      }
      else {
        await this.umount({image: image, host: mapping.hostname, id: id});
      }
    }

    const queue = !fileSystem || fileSystem === '*' ? 'rbd' : `rbd:${fileSystem}`;
    const args = [{
      image: image,
      pool: pool,
      target: target,
      readonly: readonly,
      permanent: permanent,
      id: id
    }];

    if (!host || host === '*') {
      return await this._client.enqueue(queue, 'rbd.mount', args, {timeout: -1})
    }
    else {
      return await this._client.call(queue, host, 'rbd.mount', args, {timeout: -1});
    }
  }

  /**
   * @returns {Promise.<Array.<{host: String, mountPoint: String}>>}
   */
  async umount({image, host = '*', pool = '*', id = 'admin', force = false}) {
    const args = [{
      image: image,
      pool: pool,
      id: id,
      force: force
    }];

    if (!host || host === '*') {
      const hosts =  (await this.hosts()).map(x => x.hostname);
      const result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('rbd', 'rbd.umount',
          args, {timeout: -1, waitForHosts: hosts}));

      if (result.length < 1) {
        return [];
      }

      if (result.every(x => !x.success)) {
        throw new Error(result.filter(x => !x.success)[0]);
      }

      return result.filter(x => x.success && x.data.result).map(x => ({
        host: x.hostname,
        mountPoint: x.data.mountPoint
      }));
    }
    else {
      const result = await this._client.call('rbd', host, 'rbd.umount', args, {timeout: -1});

      if (!result.result) {
        return [];
      }

      return [{
        host: host,
        mountPoint: result.mountPoint
      }];
    }
  }

  /**
   * @returns {Promise.<Array.<{host: String, mountPoints: Array.<{
   * image: String, location: String, device: String, rbdId: Number,
   * diskSize: Number|null, diskUsed: Number|null, fileSystem: String,
   * readOnly: Boolean
   * }>}>>}
   */
  async automount({host = '*'}) {
    let result = null;

    if (!host || host === '*') {
      const hosts =  (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('rbd', 'rbd.automount',
          [], {timeout: -1, waitForHosts: hosts}));

      if (result.length < 1) {
        return [];
      }

      if (result.every(x => !x.success)) {
        throw new Error(result.filter(x => !x.success)[0]);
      }

      return result.filter(x => x.success && x.data.mountPoints.length > 0).map(x => ({
        host: x.hostname,
        mountPoints: x.data.mountPoints
      }));
    }
    else {
      const result = await this._client.call('rbd', host, 'rbd.automount', [], {timeout: -1});

      if (!result.result) {
        return [];
      }

      return [{
        host: host,
        mountPoints: result.mountPoints
      }];
    }
  }

  /**
   * @returns {Promise.<void>}
   */
  async rm({image, pool = '*', id = 'admin'} = {}) {
    await this.umount({image: image, pool: pool, id: id});
    const result = await this._client.enqueue('rbd', 'rbd.rm', [{
      image: image,
      pool: pool,
      id: id
    }]);

    if (!result) {
      throw new Error('operation failed due to unknown reason: false');
    }
  }

  /**
   * @returns {Promise.<void>}
   */
  async extend({image, size, pool = '*', id = 'admin'}) {
    const name = ImageNameParser.parse(image, pool);
    const mapped = (await this.getMapped({id: 'admin'})).filter(x => x.image === name.fullName && !x.readOnly);

    let result = null;
    const args = [{
      image: image,
      size: size,
      pool: pool,
      id: id
    }];

    if (mapped.length > 0) {
      result = await this._client.call('rbd', mapped[0].hostname, 'rbd.extend', args);
    }
    else {
      result = await this._client.enqueue('rbd', 'rbd.extend', args);
    }

    if (result !== true) {
      throw new Error('unknown error occured while extending image');
    }
  }
}


module.exports = RbdProxy;
