"use strict";

const UnfoldBroadcast = require('../../utils/UnfoldBroadcast');

class SambaProxy {
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
   * @returns {Promise.<Array.<{types: Array.<String>, hostname: String, version: String}>>}
   */
  hosts() {
    return this._client.listHostsForType('samba');
  }

  /**
   * @param {string|null} host
   * @returns {Promise.<Array.<SambaShare>>}
   */
  async ls(host = '*') {
    let result = null;

    if (!host || host === '*') {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = await this._client.broadcastType('samba', 'samba.ls', [],
        {waitForHosts: hosts, timeout: -1});
    }
    else {
      result = {
        [host]: {
          instance: {
            hostname: host,
            instance: 'instance',
            success: true,
            data: await this._client.call('samba', host, 'samba.ls', [], {timeout: -1})
          }
        }
      };
    }

    result = UnfoldBroadcast.unfold(result);

    return result
      .filter(x => x.success)
      .map(x => x.data)
      .reduce((prev, cur) => prev.concat(cur), []);
  }

  /**
   * @param shareName
   * @returns {Promise.<SambaShare>}
   */
  async getShare(shareName) {
    shareName = shareName.toLowerCase();

    const result = (await this.ls()).filter(x => x.name.toLowerCase() === shareName)[0];

    if (!result) {
      throw new Error(`samba share not found: ${shareName}`);
    }

    return result;
  }

  /**
   * @param {string} shareName
   * @param {string} username
   * @returns {Promise.<SambaAcl>}
   */
  async getUser(shareName, username) {
    const share = await this.getShare(shareName);

    if (!(username in share.acl)) {
      throw new Error(`samba user "${username}" not found in share "${shareName}"`);
    }

    return share.acl[username];
  }

  /**
   * @param {string} shareName
   * @returns {Promise.<string|null>}
   * @private
   */
  async _findHostForShare(shareName) {
    shareName = shareName.toLowerCase();

    const result = (await this.ls()).filter(x => x.name.toLowerCase() === shareName)[0];

    if (result) {
      return result.host;
    }
    else {
      return null;
    }
  }

  /**
   * @param {string} shareName
   * @returns {Promise.<boolean>}
   */
  async exists(shareName) {
    shareName = shareName.toLowerCase();

    return (await this.ls()).some(x => x.name.toLowerCase() === shareName);
  }

  /**
   * @param {SambaShare} share
   * @param {string|null} host
   * @returns {Promise.<SambaShare>}
   */
  add(share, host = '*') {
    if (!host || host === '*') {
      return this._client.enqueue('samba', 'samba.add', [share], {timeout: -1});
    }
    else {
      return this._client.call('samba', host, 'samba.add', [share], {timeout: 60000});
    }
  }

  /**
   * @param {string} shareName
   * @returns {Promise.<void>}
   */
  async del(shareName) {
    const host = await this._findHostForShare(shareName);
    let result = null;

    if (host) {
      result = await this._client.call('samba', host, 'samba.del', [shareName], {timeout: -1});
    }
    else {
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.del', [shareName], {timeout: 60000})
      ).some(x => x.success && x.data);
    }

    if (!result) {
      throw new Error(`could not delete share "${shareName}" either share not found or timeout exceeded`);
    }
  }

  /**
   * @param {string} shareName
   * @param {string} username
   * @param {SambaAcl} acl
   * @returns {Promise.<void>}
   */
  async addUser(shareName, username, acl) {
    const host = await this._findHostForShare(shareName);
    let result = null;

    if (host) {
      result = await this._client.call('samba', host, 'samba.addUser', [shareName, username, acl], {timeout: -1});
    }
    else {
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.addUser', [shareName, username, acl], {timeout: 60000})
      ).some(x => x.success && x.data);
    }

    if (!result) {
      throw new Error(`could not add user "${username}" to share "${shareName}" either share not found or timeout exceeded`);
    }
  }

  /**
   * @param {string} shareName
   * @param {string} username
   * @returns {Promise.<void>}
   */
  async delUser(shareName, username) {
    const host = await this._findHostForShare(shareName);
    let result = null;

    if (host) {
      result = await this._client.call('samba', host, 'samba.delUser', [shareName, username], {timeout: -1});
    }
    else {
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.delUser', [shareName, username], {timeout: 60000})
      ).some(x => x.success && x.data);
    }

    if (!result) {
      throw new Error(`could not delete user "${username}" from share "${shareName}" either share not found or timeout exceeded`);
    }
  }

  /**
   * @param {string} shareName
   * @param {string} username
   * @param {SambaAcl} acl
   * @returns {Promise.<void>}
   */
  async editUser(shareName, username, acl) {
    const host = await this._findHostForShare(shareName);
    let result = null;

    if (host) {
      result = await this._client.call('samba', host, 'samba.editUser', [shareName, username, acl], {timeout: -1});
    }
    else {
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.editUser', [shareName, username, acl], {timeout: 60000})
      ).some(x => x.success && x.data);
    }

    if (!result) {
      throw new Error(`could not edit user "${username}" for share "${shareName}" either share not found or timeout exceeded`);
    }
  }

  /**
   * @param {SambaShare} share
   * @returns {Promise.<void>}
   */
  async update(share) {
    const result = this._client.call('samba', share.host, 'samba.update', [share], {timeout: -1});

    if (!result) {
      throw new Error(`could not update share "${share.name}" either share not found or timeout exceeded`);
    }
  }

  /**
   * @param {string} shareName
   * @param {string} newName
   * @returns {Promise.<void>}
   */
  async rename(shareName, newName) {
    const host = await this._findHostForShare(shareName);
    let result = null;

    if (host) {
      result = await this._client.call('samba', host, 'samba.rename', [shareName, newName], {timeout: -1});
    }
    else {
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.rename', [shareName, newName], {timeout: 60000})
      ).some(x => x.success && x.data);
    }

    if (!result) {
      throw new Error(`could not rename share "${shareName}" either share not found or timeout exceeded`);
    }
  }

  /**
   * @param {string} shareName
   * @param {number} size
   * @returns {Promise.<void>}
   */
  async extend(shareName, size) {
    const host = await this._findHostForShare(shareName);
    let result = null;

    if (host) {
      result = await this._client.call('samba', host, 'samba.extend', [shareName, size], {timeout: -1});
    }
    else {
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.extend', [shareName, size], {timeout: 60000})
      ).some(x => x.success && x.data);
    }

    if (!result) {
      throw new Error(`could not extend share "${shareName}" either share not found or timeout exceeded`);
    }
  }
}

module.exports = SambaProxy;





