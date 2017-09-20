"use strict";

const CephProxy = require('./ceph');
const RbdProxy = require('./rbd');
const SambaProxy = require('./samba');
const IScsiProxy = require('./iscsi');

class Proxy {
  /**
   * @param {ClientLoop} client
   */
  constructor (client) {
    this._client = client;
    this._ceph = null;
    this._rbd = null;
    this._samba = null;
    this._iscsi = null;
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
   * @returns {SambaProxy}
   */
  get samba() {
    if (!this._samba) {
      this._samba = new SambaProxy(this._client);
    }

    return this._samba;
  }

  /**
   * @returns {IScsiProxy}
   */
  get iscsi() {
    if (!this._iscsi) {
      this._iscsi = new IScsiProxy(this._client);
    }

    return this._iscsi;
  }

  /**
   * @returns {Promise.<WorkerInfoResponse>}
   */
  hosts() {
    return this._client.listHosts();
  }
}

module.exports = Proxy;
