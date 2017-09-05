"use strict";

const CephProxy = require('./ceph');
const RbdProxy = require('./rbd');

class Proxy {
  /**
   * @param {ClientLoop} client
   */
  constructor (client) {
    this._client = client;
    this._ceph = null;
    this._rbd = null;
  }

  /**
   *
   * @returns {ClientLoop}
   */
  get client() {
    return this._client;
  }

  /**
   * @returns {CephProxy}
   */
  get ceph() {
    if (!this._ceph) {
      this._ceph = new CephProxy(this._client);
    }

    return this._ceph;
  }

  /**
   * @returns {RbdProxy}
   */
  get rbd() {
    if (!this._rbd) {
      this._rbd = new RbdProxy(this._client);
    }

    return this._rbd;
  }

  /**
   * @returns {Promise.<Array.<{types: Array.<String>, hostname: String, version: String}>>}
   */
  hosts() {
    return this._client.listHosts();
  }
}

module.exports = Proxy;
