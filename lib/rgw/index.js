"use strict";

const Shell = require('../utils/Shell');
const SizeParser = require('../utils/SizeParser');
const ErrorFormatter = require('../utils/ErrorFormatter');
const log = require('logging').default('RadosGatewayClient');

/**
 * @typedef {object} RadosGatewayUser
 * @property {string} username
 * @property {string} fullName
 * @property {string} email
 * @property {string|null} accessKey
 * @property {string|null} secretKey
 * @property {number|null} capacity
 * @property {number} used
 */

/**
 * @typedef {Object.<string, RadosGatewayUser>} RadosGatewayUserList
 */

class RadosGatewayClient {
  /**
   * @param {{db: LevelDb}} opts
   */
  constructor(opts) {

  }

  /**
   * @returns {Promise.<boolean>}
   */
  static async capable() {
    try {
      const client = new RadosGatewayClient({});
      await client.users();

      return true;
    }
    catch (err) {
      log.error(ErrorFormatter.format(err));
      return false;
    }
  }

  /**
   * @param {string} user
   * @returns {Promise.<RadosGatewayUser>}
   * @private
   */
  async _findUser(user) {
   const info = JSON.parse(await Shell.exec('radosgw-admin', 'user', 'info', `--uid=${user}`));
    let stats = {
      stats: {
        total_bytes: 0
      }
    };

    try {
      stats = JSON.parse(await Shell.exec('radosgw-admin', 'user', 'stats', `--uid=${user}`));
    }
    catch (err) {
      try {
        stats = JSON.parse(await Shell.exec('radosgw-admin', 'user', 'stats', `--uid=${user}`, '--sync-stats'));
      }
      catch (err2) {
      }
    }

    return {
      username: user,
      fullName: info.display_name,
      email: info.email,
      accessKey: info.keys.length > 0 ? info.keys[0].access_key : null,
      secretKey: info.keys.length > 0 ? info.keys[0].secret_key : null,
      capacity: info.user_quota.enabled && info.user_quota.max_size_kb >= 0 ?
        info.user_quota.max_size_kb / 1024 : 0,
      used: stats.stats.total_bytes / (1024 * 1024)
    }
  }

  /**
   * @returns {Promise.<RadosGatewayUserList>}
   */
  async users() {
    return (await Promise.all(
      (JSON.parse(await Shell.exec('radosgw-admin', 'metadata', 'list', 'user')))
        .map(async user => this._findUser(user))))
        .map(user => ({
          [user.username]: user
        })).reduce((prev, cur) => Object.assign(prev, cur), {});
  }

  /**
   * @param {string} username
   * @param {string|null} displayName
   * @param {string|null} email
   * @returns {Promise.<RadosGatewayUser>}
   */
  async add({username, displayName = null, email = null} = {}) {
    await Shell.exec('radosgw-admin', 'user', 'create', `--uid=${username}`,
      `--display-name="${displayName || ''}"`,
      email ? `--email="${email}"` : '');

    return await this._findUser(username);
  }

  /**
   * @param {string} username
   * @param {number} size
   * @returns {Promise.<RadosGatewayUser>}
   */
  async enableQuota(username, size) {
    await Shell.exec('radosgw-admin', 'quota', 'set', '--quota-scope=user',
      `--uid=${username}`, `--max-size=${SizeParser.stringify(size)}`);
    await Shell.exec('radosgw-admin', 'quota', 'enable', '--quota-scope=user',
      `--uid=${username}`);

    return await this._findUser(username);
  }

  /**
   * @param {string} username
   * @returns {Promise.<RadosGatewayUser>}
   */
  async disableQuota(username) {
    await Shell.exec('radosgw-admin', 'quota', 'disable', '--quota-scope=user',
      `--uid=${username}`);

    return await this._findUser(username);
  }

  /**
   * @param {string} username
   * @returns {Promise.<boolean>}
   */
  async del(username) {
    await Shell.exec('radosgw-admin', 'user', 'rm', `--uid=${username}`);
    return true;
  }
}

module.exports = RadosGatewayClient;
