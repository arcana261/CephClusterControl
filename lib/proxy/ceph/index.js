"use strict";

const CephPoolProxy = require('./CephPoolProxy');

class CephProxy {
  /**
   * @param {ClientLoop} client
   */
  constructor (client) {
    this._client = client;
    this._pool = null;
  }

  /**
   * @returns {ClientLoop}
   */
  get client() {
    return this._client;
  }

  /**
   * @returns {CephPoolProxy}
   */
  get pool() {
    if (!this._pool) {
      this._pool = new CephPoolProxy(this._client);
    }

    return this._pool;
  }

  /**
   * @returns {Promise.<Array.<{types: Array.<String>, hostname: String, version: String}>>}
   */
  hosts() {
    return this._client.listHostsForType('ceph');
  }
}

module.exports = CephProxy;
