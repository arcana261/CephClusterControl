"use strict";

const UnfoldBroadcast = require('../../utils/UnfoldBroadcast');

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
   * @returns {Promise.<Array.<{types: Array.<String>, hostname: String, version: String}>>}
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
  updateDiskUsage({image, pool = '*', id = 'admin'} = {}) {
    return this._client.enqueue('rbd', 'rbd.updateDiskUsage', [{
      image: image,
      id: id,
      pool: pool
    }], {timeout: -1});
  }

  /**
   * @returns {Promise.<{image: String, size: Number, objectCount: Number, order: Number,
   * objectSize: Number, blockNamePrefix: String, format: Number,
   * features: Array.<String>, flags: Array.<String>}>}
   */
  info({image, pool = '*', id = 'admin'} = {}) {
    return this._client.enqueue('rbd', 'rbd.info', [{
      image: image,
      id: id,
      pool: pool
    }]);
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
    }]);
  }
}

module.exports = RbdProxy;
