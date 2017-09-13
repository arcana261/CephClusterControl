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

  /**
   * @param {string} pool
   * @returns {Promise.<number|null>}
   */
  getQuota(pool) {
    return this._client.enqueue('ceph', 'ceph.pool.getQuota', [pool]);
  }

  /**
   * @param {string} pool
   * @param {number} size
   * @returns {Promise.<void>}
   */
  async setQuota(pool, size) {
    const result = await this._client.enqueue('ceph', 'ceph.pool.setQuota', [pool, size]);

    if (!result) {
      throw new Error('unknown error occured while processing request: false');
    }
  }

  /**
   * @param {string} name
   * @param {number} pgnum
   * @param {number} pgpnum
   * @returns {Promise.<void>}
   */
  async create(name, pgnum, pgpnum) {
    const result = await this._client.enqueue('ceph', 'ceph.pool.create', [name, pgnum, pgpnum]);

    if (!result) {
      throw new Error('unknown error occured while processing request: false');
    }
  }

  /**
   * @param {string} name
   * @returns {Promise.<void>}
   */
  async del(name) {
    const result = await this._client.enqueue('ceph', 'ceph.pool.del', [name]);

    if (!result) {
      throw new Error('unknown error occurred while processing request: false');
    }
  }

  /**
   * @returns {Promise.<Object.<String, {used: Number, objects: Number}>>}
   */
  df() {
    return this._client.enqueue('ceph', 'ceph.pool.df', []);
  }
}

module.exports = CephPoolProxy;
