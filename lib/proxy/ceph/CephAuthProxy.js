"use strict";

const CephAuthUtils = require('../../utils/CephAuthUtils');
const fs = require('mz/fs');

class CephAuthProxy {
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
   * @returns {Promise.<CephAuthList>}
   */
  ls() {
    return this._client.enqueue('ceph', 'ceph.auth.ls', []);
  }

  /**
   * @param {string} client
   * @param {CephCaps} caps
   * @returns {Promise.<boolean>}
   */
  async checkPermission(client, caps) {
    const auth = await this.ls();

    if (!(client in auth)) {
      return false;
    }

    return CephAuthUtils.checkPermission(auth[client].caps, caps);
  }

  /**
   * @param {string} client
   * @param {CephCaps} caps
   * @returns {Promise.<void>}
   */
  async add(client, caps) {
    const result = await this._client.enqueue('ceph', 'ceph.auth.add', [client, caps]);

    if (!result) {
      throw new Error('unknown error occured while processing request: false');
    }
  }

  /**
   * @param {string} client
   * @returns {Promise.<string>}
   */
  get(client) {
    return this._client.enqueue('ceph', 'ceph.auth.get', [client]);
  }

  /**
   * @param {string} client
   * @returns {Promise.<string>}
   */
  async save(client) {
    const keyring = await this.get(client);
    await fs.writeFile(`/etc/ceph/ceph.${client}.keyring`, keyring);
    return keyring;
  }

  /**
   * @param {string} client
   * @returns {Promise.<void>}
   */
  async del(client) {
    const result = await this._client.enqueue('ceph', 'ceph.auth.del', [client]);

    if (!result) {
      throw new Error('unknown error occured while processing request: false');
    }
  }
}

module.exports = CephAuthProxy;
