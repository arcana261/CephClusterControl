"use strict";

const CephProxy = require('./ceph');
const RbdProxy = require('./rbd');
const SambaProxy = require('./samba');
const IScsiProxy = require('./iscsi');
const NtpProxy = require('./ntp');
const RadosGatewayProxy = require('./rgw');
const MultipartProxy = require('./multipart');
const UpdaterProxy = require('./updater');

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
    this._ntp = null;
    this._rgw = null;
    this._multipart = null;
    this._updater = null;
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
   * @returns {NtpProxy}
   */
  get ntp() {
    if (!this._ntp) {
      this._ntp = new NtpProxy(this._client);
    }

    return this._ntp;
  }

  /**
   * @returns {RadosGatewayProxy}
   */
  get rgw() {
    if (!this._rgw) {
      this._rgw = new RadosGatewayProxy(this._client);
    }

    return this._rgw;
  }

  /**
   * @returns {MultipartProxy}
   */
  get multipart() {
    if (!this._multipart) {
      this._multipart = new MultipartProxy(this._client);
    }

    return this._multipart;
  }

  /**
   * @returns {UpdaterProxy}
   */
  get updater() {
    if (!this._updater) {
      this._updater = new UpdaterProxy(this._client);
    }

    return this._updater;
  }

  /**
   * @returns {Promise.<WorkerInfoResponse>}
   */
  hosts() {
    return this._client.listHosts();
  }
}

module.exports = Proxy;
