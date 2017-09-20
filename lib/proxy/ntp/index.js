"use strict";

const UTCClock = require('utc-clock');

class NtpProxy {
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
   * @returns {Number}
   * @private
   */
  _ms() {
    return (new UTCClock()).now.ms();
  }

  /**
   * @returns {Promise.<WorkerInfoResponse>}
   */
  hosts() {
    return this._client.listHostsForType('ntp');
  }

  /**
   * @returns {Promise.<Array.<{hostname: String, offset: Number}>>}
   */
  async tick() {
    return Promise.all(
      (await this.hosts())
        .map(async host => {
          const now = this._ms();
          const result =  await this._client.call('ntp', host.hostname, 'ntp.tick', []);
          const then = this._ms();

          return {hostname: host.hostname, offset: result.clock - ((now + then) / 2)};
        }));
  }

  /**
   * @returns {Promise.<Array.<{hostname: String, servers: Array.<NtpServerStatus>}>>}
   */
  async server() {
    return Promise.all(
      (await this.hosts())
        .map(async host => {
          return {
            hostname: host.hostname,
            servers: await this._client.call('ntp', host.hostname, 'ntp.server', [])
          };
        }));
  }

  /**
   * @param {string|null} host
   * @returns {Promise.<void>}
   */
  async makeStep(host = '*') {
    if (!host || host === '*') {
      await this._client.broadcastType('ntp', 'ntp.makeStep', [], {
        timeout: -1,
        waitForHosts: (await this.hosts()).map(x => x.hostname)
      });
    }
    else {
      await this._client.call('ntp', 'ntp.makeStep', [], {timeout: -1});
    }
  }
}

module.exports = NtpProxy;
