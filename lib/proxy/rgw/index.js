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
   * @returns {Promise.<RadosGatewayUserList>}
   */
  users() {
    return this._client.enqueue('rgw', 'rgw.users', []);
  }

  /**
   * @param username
   * @param displayName
   * @param email
   * @returns {Promise.<RadosGatewayUser>}
   */
  add({username, displayName = null, email = null} = {}) {
    return this._client.enqueue('rgw', 'rgw.add', [{
      username: username,
      displayName: displayName,
      email: email
    }]);
  }

  /**
   * @param {string} username
   * @param {number} size
   * @returns {Promise.<RadosGatewayUser>}
   */
  enableQuota(username, size) {
    return this._client.enqueue('rgw', 'rgw.enableQuota', [username, size]);
  }

  disableQuota(username) {
    return this._client.enqueue('rgw', 'rgw.disableQuota', [username]);
  }

  /**
   * @param {string} username
   * @returns {Promise.<void>}
   */
  async del(username) {
    const result = await this._client.enqueue('rgw', 'rgw.del', [username]);

    if (!result) {
      throw new Error('unknown error occurred during operation: false');
    }
  }
}

module.exports = RadosGatewayProxy;
