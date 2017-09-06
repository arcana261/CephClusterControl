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

  /**
   * @returns {Promise.<Array.<{
   * hostname: String, instanceId: String, image: String,
   * rbdId: Number, snap: String, device: String, diskSize: Number
   * diskUsed: Number, mountPoint: String, fileSystem: String
   * }>>}
   */
  async getMapped({host = '*', id = 'admin'}) {
    let result = null;

    if (!host || host === '*') {
      result = await this._client.broadcastType('rbd', 'rbd.getMapped', [{id: id}]);
    }
    else {
      result = {
        [host]: {
          instance: {
            hostname: host,
            instance: 'instance',
            success: true,
            data: await this._client.call('rbd', host, 'rbd.getMapped', [{id: id}])
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
   * @returns {Promise.<String>}
   */
  mount({image, host, pool = '*', target = '*', readonly = false,
          permanent = false, id = 'admin', fileSystem = '*'} = {}) {
    const queue = !fileSystem || fileSystem === '*' ? 'rbd' : `rbd:${fileSystem}`;

    return this._client.call(queue, host, 'rbd.mount', [{
      image: image,
      pool: pool,
      target: target,
      readonly: readonly,
      permanent: permanent,
      id: id
    }]);
  }
}

module.exports = RbdProxy;
