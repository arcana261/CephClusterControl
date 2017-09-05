"use strict";

class CephPoolProxy {
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
   * @returns {Promise.<Array.<String>>}
   */
  ls() {
    return this._client.enqueue('ceph', 'ceph.pool.ls', []);
  }
}

module.exports = CephPoolProxy;
