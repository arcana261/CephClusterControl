"use strict";

const UnfoldBroadcast = require('../../utils/UnfoldBroadcast');

class IScsiProxy {
  /**
   * @param {ClientLoop} client
   */
  constructor(client) {
    this._client = client;
  }

  /**
   * @returns {ClientLoop}
   */
  get client() {
    return this._client;
  }

  /**
   * @returns {Promise.<IScsiWorkerInfoResponse>}
   */
  async hosts({timeout = 0} = {}) {
    return UnfoldBroadcast.unfold(await this._client.broadcastType('iscsi', 'iscsi.report', [], {timeout: timeout}))
      .filter(x => x.success)
      .map(x => x.data);
  }

  /**
   * @param host
   * @param timeout
   * @returns {Promise.<IScsiWorkerInfoResponseItem>}
   */
  async report(host, {timeout = 0} = {}) {
    return this._client.call('iscsi', host, 'iscsi.report', [], {timeout: timeout});
  }

  /**
   * @param {string} host
   * @param {number} timeout
   * @param {Array.<string>} filter
   * @param {boolean} usage
   * @returns {Promise.<Array.<IScsiTarget>>}
   */
  async ls(host = '*', {timeout = -1, filter = [], usage = true} = {}) {
    let result = null;

    const args = [{
      filter: filter,
      usage: usage
    }];

    if (!host || host === '*') {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = await this._client.broadcastType('iscsi', 'iscsi.ls', args,
        {waitForHosts: hosts, timeout: timeout});
    }
    else {
      result = {
        [host]: {
          instance: {
            hostname: host,
            instance: 'instance',
            success: true,
            data: await this._client.call('iscsi', host, 'iscsi.ls', args, {timeout: timeout})
          }
        }
      };
    }

    return UnfoldBroadcast.unfold(result)
      .filter(x => x.success)
      .map(x => x.data)
      .reduce((prev, cur) => prev.concat(cur), []);
  }

  /**
   * @param {string} name
   * @returns {Promise.<IScsiTarget>}
   */
  async getTarget(name) {
    name = name.toLowerCase();

    const result = (await this.ls()).filter(x => x.iqn.name.toLowerCase() === name)[0];

    if (!result) {
      throw new Error(`iscsi target not found: "${name}"`);
    }

    return result;
  }

  /**
   * @param {string} name
   * @returns {Promise.<boolean>}
   */
  async exists(name) {
    name = name.toLowerCase();

    return (await this.ls()).some(x => x.iqn.name.toLowerCase() === name);
  }

  /**
   * @param {string} name
   * @returns {Promise.<string>}
   * @private
   */
  async _findHostForTarget(name) {
    name = name.toLowerCase();

    const result = (await this.ls()).filter(x => x.iqn.name.toLowerCase() === name)[0];

    if (result) {
      return result.host;
    }
    else {
      return null;
    }
  }

  /**
   * @param {string} name
   * @param {string|null} host
   * @param {string|null} domain
   * @param {string} image
   * @param {string|null} pool
   * @param {number} size
   * @param {number} timeout
   * @returns {Promise.<IScsiTarget>}
   */
  async add({name, host = '*', domain = '*', image, pool = '*', size, timeout = -1} = {}) {
    if ((await this.exists(name))) {
      throw new Error(`iscsi share ${name} already exists`);
    }

    if (!domain || domain === '*') {
      domain = 'kstorage.org';
    }

    const index = domain.lastIndexOf('.');

    if (index < 0) {
      throw new Error(`invalid domain provided for iqn ${domain}`);
    }

    const iqnHost = domain.substr(0, index);
    const iqnDomain = domain.substr(index + 1);

    const args = [{
      name: name,
      host: iqnHost,
      domain: iqnDomain,
      image: image,
      pool: pool,
      size: size
    }];

    if (!host || host === '*') {
      return await this._client.enqueue('iscsi', 'iscsi.add', args, {timeout: timeout});
    }
    else {
      return await this._client.call('iscsi', host, 'iscsi.add', args, {timeout: timeout});
    }
  }

  /**
   * @param {string} name
   * @param {string} password
   * @param {string|null} host
   * @param {number} timeout
   * @returns {Promise.<IScsiTarget>}
   */
  async enableAuthentication(name, password, {host = '*', timeout = -1} = {}) {
    const hostName = (host && host !== '*') ? host : (await this._findHostForTarget(name));
    let result = null;

    if (hostName) {
      result = await this._client.call('iscsi', hostName, 'iscsi.enableAuthentication',
        [name, password], {timeout: -1});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(await this._client.broadcastType('iscsi', 'iscsi.enableAuthentication',
        [name, password], {waitForHosts: hosts, timeout: -1}))
        .filter(x => x.success)
        .map(x => x.data)[0];
    }

    if (!result) {
      throw new Error('operation failed: empty result');
    }

    return result;
  }

  /**
   * @param {string} name
   * @param {string|null} host
   * @param {number} timeout
   * @returns {Promise.<IScsiTarget>}
   */
  async disableAuthentication(name, {host = '*', timeout = -1} = {}) {
    const hostName = (host && host !== '*') ? host : (await this._findHostForTarget(name));
    let result = null;

    if (hostName) {
      result = await this._client.call('iscsi', hostName, 'iscsi.disableAuthentication',
        [name], {timeout: timeout});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(await this._client.broadcastType('iscsi', 'iscsi.disableAuthentication',
        [name], {waitForHosts: hosts, timeout: timeout}))
        .filter(x => x.success)
        .map(x => x.data)[0];
    }

    if (!result) {
      throw new Error('operation failed: empty result');
    }

    return result;
  }

  /**
   * @param {string} name
   * @param {number} size
   * @param {string} host
   * @param {number} timeout
   * @returns {Promise.<IScsiTarget>}
   */
  async addLun(name, size, {host = '*', timeout = -1} = {}) {
    const hostName = (host && host !== '*') ? host : (await this._findHostForTarget(name));
    let result = null;

    if (hostName) {
      result = await this._client.call('iscsi', hostName, 'iscsi.addLun',
        [name, size], {timeout: timeout});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(await this._client.broadcastType('iscsi', 'iscsi.addLun',
        [name, size], {waitForHosts: hosts, timeout: timeout}))
        .filter(x => x.success)
        .map(x => x.data)[0];
    }

    if (!result) {
      throw new Error('operation failed: empty result');
    }

    return result;
  }

  /**
   * @param {string} name
   * @param {boolean} destroyData
   * @returns {Promise.<IScsiTarget>}
   */
  async del(name, destroyData) {
    const host = await this._findHostForTarget(name);
    let result = null;

    if (host) {
      result = await this._client.call('iscsi', host, 'iscsi.del',
        [name, destroyData], {timeout: -1});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(await this._client.broadcastType('iscsi', 'iscsi.del',
        [name, destroyData], {waitForHosts: hosts, timeout: -1}))
        .filter(x => x.success)
        .map(x => x.data)[0];
    }

    if (!result) {
      throw new Error('operation failed: empty result');
    }

    return result;
  }

  /**
   * @param {string} name
   * @param {string} newName
   * @returns {Promise.<IScsiTarget>}
   */
  async rename(name, newName) {
    const host = await this._findHostForTarget(name);
    let result = null;

    if (host) {
      result = await this._client.call('iscsi', host, 'iscsi.rename',
        [name, newName], {timeout: -1});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(await this._client.broadcastType('iscsi', 'iscsi.rename',
        [name, newName], {waitForHosts: hosts, timeout: -1}))
        .filter(x => x.success)
        .map(x => x.data)[0];
    }

    if (!result) {
      throw new Error('operation failed: empty result');
    }

    return result;
  }

  /**
   * @param {string} name
   * @param {number} size
   * @param {string|null} host
   * @param {number} timeout
   * @returns {Promise.<IScsiTarget>}
   */
  async extend(name, size, {host = '*', timeout = -1} = {}) {
    const hostName = (host && host !== '*') ? host : (await this._findHostForTarget(name));
    let result = null;

    if (hostName) {
      result = await this._client.call('iscsi', hostName, 'iscsi.extend',
        [name, size], {timeout: timeout});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(await this._client.broadcastType('iscsi', 'iscsi.extend',
        [name, size], {waitForHosts: hosts, timeout: timeout}))
        .filter(x => x.success)
        .map(x => x.data)[0];
    }

    if (!result) {
      throw new Error('operation failed: empty result');
    }

    return result;
  }

  /**
   * @param {string} host
   * @param {string|null} domain
   * @param {string} password
   * @param {number} timeout
   * @returns {Promise.<void>}
   */
  async enableDiscoveryAuthentication({host, domain = '*', password, timeout = -1} = {}) {
    if (!domain || domain === '*') {
      domain = 'kstorage.org';
    }

    const index = domain.lastIndexOf('.');

    if (index < 0) {
      throw new Error(`invalid domain provided for iqn ${domain}`);
    }

    const iqnHost = domain.substr(0, index);
    const iqnDomain = domain.substr(index + 1);

    const result = await this._client.call('iscsi', host, 'iscsi.enableDiscoveryAuthentication',
      [iqnHost, iqnDomain, password], {timeout: timeout});

    if (!result) {
      throw new Error('unknown error occurred in operation: false');
    }
  }

  /**
   * @param {string} host
   * @param {number} timeout
   * @returns {Promise.<void>}
   */
  async disableDiscoveryAuthentication(host, {timeout = -1} = {}) {
    const result = await this._client.call('iscsi', host, 'iscsi.disableDiscoveryAuthentication',
      [], {timeout: timeout});

    if (!result) {
      throw new Error('unknown error occurred in operation: false');
    }
  }
}

module.exports = IScsiProxy;
