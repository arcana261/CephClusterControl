"use strict";

class RadosGatewayProxy {
  /**
   * @param {ClientLoop} client
   */
  constructor(client) {
    this._client = client;
  }

  /**
   * @returns {Promise.<WorkerInfoResponse>}
   */
  hosts() {
    return this._client.listHostsForType('rgw');
  }

  /**
   * @returns {ClientLoop}
   */
  get client() {
    return this._client;
  }

  /**
   * @param {number} timeout
   * @returns {Promise.<RadosGatewayUserList>}
   */
  users({timeout = -1} = {}) {
    return this._client.enqueue('rgw', 'rgw.users', [], {timeout: timeout});
  }

  /**
   * @param username
   * @param displayName
   * @param email
   * @param {number} timeout
   * @returns {Promise.<RadosGatewayUser>}
   */
  add({username, displayName = null, email = null, timeout = -1} = {}) {
    return this._client.enqueue('rgw', 'rgw.add', [{
      username: username,
      displayName: displayName,
      email: email
    }], {timeout: timeout});
  }

  /**
   * @param {string} username
   * @param {number} size
   * @param {number} timeout
   * @returns {Promise.<RadosGatewayUser>}
   */
  enableQuota(username, size, {timeout = -1} = {}) {
    return this._client.enqueue('rgw', 'rgw.enableQuota', [username, size], {timeout: timeout});
  }

  /**
   * @param {string} username
   * @param {number} timeout
   * @returns {*}
   */
  disableQuota(username, {timeout = -1} = {}) {
    return this._client.enqueue('rgw', 'rgw.disableQuota', [username], {timeout: timeout});
  }

  /**
   * @param {string} username
   * @param {number} timeout
   * @returns {Promise.<void>}
   */
  async del(username, {timeout = -1} = {}) {
    const result = await this._client.enqueue('rgw', 'rgw.del', [username], {timeout: timeout});

    if (!result) {
      throw new Error('unknown error occurred during operation: false');
    }
  }
}

module.exports = RadosGatewayProxy;
