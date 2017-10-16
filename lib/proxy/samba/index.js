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
   * @returns {Promise.<WorkerInfoResponse>}
   */
  hosts() {
    return this._client.listHostsForType('samba');
  }

  /**
   * @param {string|null} host
   * @param {boolean} info
   * @returns {Promise.<Array.<SambaShare>>}
   */
  async ls(host = '*', {info = true, timeout = -1} = {}) {
    let result = null;

    const args = [{
      info: info
    }];

    if (!host || host === '*') {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = await this._client.broadcastType('samba', 'samba.ls', args,
        {waitForHosts: hosts, timeout: timeout});
    }
    else {
      result = {
        [host]: {
          instance: {
            hostname: host,
            instance: 'instance',
            success: true,
            data: await this._client.call('samba', host, 'samba.ls', args, {timeout: timeout})
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
   * @param {string} shareName
   * @param {string|null} host
   * @param {number} timeout
   * @param {boolean} info
   * @returns {Promise.<SambaShare>}
   */
  async getShare(shareName, {host = '*', timeout = 0, info = true} = {}) {
    shareName = shareName.toLowerCase();

    const result = (await this.ls(host, {info: info, timeout: timeout}))
      .filter(x => x.name.toLowerCase() === shareName)[0];

    if (!result) {
      throw new Error(`samba share not found: ${shareName}`);
    }

    return result;
  }

  /**
   * @param {string} shareName
   * @param {string} username
   * @param {string} host
   * @param {number} timeout
   * @returns {Promise.<SambaAcl>}
   */
  async getUser(shareName, username, {host = '*', timeout = 0} = {}) {
    const share = await this.getShare(shareName, {host: host, timeout: timeout, info: false});

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

    const result = (await this.ls({info: false})).filter(x => x.name.toLowerCase() === shareName)[0];

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
   * @param {number} timeout
   * @returns {Promise.<SambaShare>}
   */
  async add(share, host = '*', {timeout = -1} = {}) {
    if ((await this.exists(share.name))) {
      throw new Error(`share ${share.name} already exists`);
    }

    if (!host || host === '*') {
      return await this._client.enqueue('samba', 'samba.add', [share], {timeout: timeout});
    }
    else {
      return await this._client.call('samba', host, 'samba.add', [share], {timeout: timeout});
    }
  }

  /**
   * @param {string} shareName
   * @param {string|null} host
   * @param {number} timeout
   * @returns {Promise.<void>}
   */
  async del(shareName, {host = '*', timeout = -1} = {}) {
    const hostName = (host && host !== '*') ? host : (await this._findHostForShare(shareName));
    let result = null;

    if (hostName) {
      result = await this._client.call('samba', hostName, 'samba.del', [shareName], {timeout: timeout});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.del', [shareName], {waitForHosts: hosts, timeout: timeout})
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
   * @param {string|null} host
   * @param {number} timeout
   * @returns {Promise.<void>}
   */
  async addUser(shareName, username, acl, {host = '*', timeout = -1} = {}) {
    const hostName = (host && host !== '*') ? host : (await this._findHostForShare(shareName));
    let result = null;

    if (hostName) {
      result = await this._client.call('samba', hostName, 'samba.addUser', [shareName, username, acl], {timeout: timeout});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.addUser',
          [shareName, username, acl], {waitForHosts: hosts, timeout: timeout})
      ).some(x => x.success && x.data);
    }

    if (!result) {
      throw new Error(`could not add user "${username}" to share "${shareName}" either share not found or timeout exceeded`);
    }
  }

  /**
   * @param {string} shareName
   * @param {string} username
   * @param {string|null} host
   * @param {number} timeout
   * @returns {Promise.<void>}
   */
  async delUser(shareName, username, {host = '*', timeout = -1} = {}) {
    const hostName = (host && host !== '*') ? host : (await this._findHostForShare(shareName));
    let result = null;

    if (hostName) {
      result = await this._client.call('samba', hostName, 'samba.delUser', [shareName, username], {timeout: timeout});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.delUser',
          [shareName, username], {waitForHosts: hosts, timeout: timeout})
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
   * @param {string|null} host
   * @param {number} timeout
   * @returns {Promise.<void>}
   */
  async editUser(shareName, username, acl, {host = '*', timeout = -1} = {}) {
    const hostName = (host && host !== '*') ? host : (await this._findHostForShare(shareName));
    let result = null;

    if (hostName) {
      result = await this._client.call('samba', hostName, 'samba.editUser', [shareName, username, acl], {timeout: timeout});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.editUser',
          [shareName, username, acl], {waitForHosts: hosts, timeout: timeout})
      ).some(x => x.success && x.data);
    }

    if (!result) {
      throw new Error(`could not edit user "${username}" for share "${shareName}" either share not found or timeout exceeded`);
    }
  }

  /**
   * @param {SambaShare} share
   * @param {number} timeout
   * @returns {Promise.<void>}
   */
  async update(share, {timeout = -1} = {}) {
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
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.rename',
          [shareName, newName], {waitForHosts: hosts, timeout: -1})
      ).some(x => x.success && x.data);
    }

    if (!result) {
      throw new Error(`could not rename share "${shareName}" either share not found or timeout exceeded`);
    }
  }

  /**
   * @param {string} shareName
   * @param {number} size
   * @param {string|null} host
   * @param {number} timeout
   * @returns {Promise.<void>}
   */
  async extend(shareName, size, {host = '*', timeout = -1} = {}) {
    const hostName = (host && host !== '*') ? host : await this._findHostForShare(shareName);
    let result = null;

    if (hostName) {
      result = await this._client.call('samba', hostName, 'samba.extend', [shareName, size], {timeout: timeout});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(
        await this._client.broadcastType('samba', 'samba.extend',
          [shareName, size], {waitForHosts: hosts, timeout: timeout})
      ).some(x => x.success && x.data);
    }

    if (!result) {
      throw new Error(`could not extend share "${shareName}" either share not found or timeout exceeded`);
    }
  }
}

module.exports = SambaProxy;





