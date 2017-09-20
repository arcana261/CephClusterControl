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
  async hosts() {
    return UnfoldBroadcast.unfold(await this._client.broadcastType('iscsi', 'iscsi.report', []))
      .filter(x => x.success)
      .map(x => x.data);
  }

  /**
   * @param {string} host
   * @returns {Promise.<Array.<IScsiTarget>>}
   */
  async ls(host = '*') {
    let result = null;

    if (!host || host === '*') {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = await this._client.broadcastType('iscsi', 'iscsi.ls', [],
        {waitForHosts: hosts, timeout: -1});
    }
    else {
      result = {
        [host]: {
          instance: {
            hostname: host,
            instance: 'instance',
            success: true,
            data: await this._client.call('iscsi', host, 'iscsi.ls', [], {timeout: -1})
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
   * @returns {Promise.<IScsiTarget>}
   */
  async add({name, host = '*', domain = '*', image, pool = '*', size} = {}) {
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
      return await this._client.enqueue('iscsi', 'iscsi.add', args, {timeout: -1});
    }
    else {
      return await this._client.call('iscsi', host, 'iscsi.add', args, {timeout: -1});
    }
  }

  /**
   * @param {string} name
   * @param {string} password
   * @returns {Promise.<IScsiTarget>}
   */
  async enableAuthentication(name, password) {
    const host = await this._findHostForTarget(name);
    let result = null;

    if (host) {
      result = await this._client.call('iscsi', host, 'iscsi.enableAuthentication',
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
   * @returns {Promise.<IScsiTarget>}
   */
  async disableAuthentication(name) {
    const host = await this._findHostForTarget(name);
    let result = null;

    if (host) {
      result = await this._client.call('iscsi', host, 'iscsi.disableAuthentication',
        [name], {timeout: -1});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(await this._client.broadcastType('iscsi', 'iscsi.disableAuthentication',
        [name], {waitForHosts: hosts, timeout: -1}))
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
   * @returns {Promise.<IScsiTarget>}
   */
  async addLun(name, size) {
    const host = await this._findHostForTarget(name);
    let result = null;

    if (host) {
      result = await this._client.call('iscsi', host, 'iscsi.addLun',
        [name, size], {timeout: -1});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(await this._client.broadcastType('iscsi', 'iscsi.addLun',
        [name, size], {waitForHosts: hosts, timeout: -1}))
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
   * @returns {Promise.<IScsiTarget>}
   */
  async extend(name, size) {
    const host = await this._findHostForTarget(name);
    let result = null;

    if (host) {
      result = await this._client.call('iscsi', host, 'iscsi.extend',
        [name, size], {timeout: -1});
    }
    else {
      const hosts = (await this.hosts()).map(x => x.hostname);
      result = UnfoldBroadcast.unfold(await this._client.broadcastType('iscsi', 'iscsi.extend',
        [name, size], {waitForHosts: hosts, timeout: -1}))
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
   * @returns {Promise.<void>}
   */
  async enableDiscoveryAuthentication({host, domain = '*', password} = {}) {
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
      [iqnHost, iqnDomain, password], {timeout: -1});

    if (!result) {
      throw new Error('unknown error occurred in operation: false');
    }
  }

  /**
   * @param {string} host
   * @returns {Promise.<void>}
   */
  async disableDiscoveryAuthentication(host) {
    const result = await this._client.call('iscsi', host, 'iscsi.disableDiscoveryAuthentication',
      [], {timeout: -1});

    if (!result) {
      throw new Error('unknown error occurred in operation: false');
    }
  }
}

module.exports = IScsiProxy;
