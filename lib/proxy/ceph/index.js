"use strict";

const CephPoolProxy = require('./CephPoolProxy');
const CephAuthProxy = require('./CephAuthProxy');

class CephProxy {
  /**
   * @param {ClientLoop} client
   */
  constructor (client) {
    this._client = client;
    this._pool = null;
    this._auth = null;
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
   * @returns {CephAuthProxy}
   */
  get auth() {
    if (!this._auth) {
      this._auth = new CephAuthProxy(this._client);
    }

    return this._auth;
  }

  /**
   * @returns {Promise.<WorkerInfoResponse>}
   */
  hosts() {
    return this._client.listHostsForType('ceph');
  }
}

module.exports = CephProxy;
