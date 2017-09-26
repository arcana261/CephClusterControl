"use strict";

const Shell = require('../utils/Shell');
const UTCClock = require('utc-clock');
const os = require('os');
const Sleep = require('../utils/Sleep');
const Distro = require('../utils/Distro');
const log = require('logging').default('NtpClient');
const ErrorFormatter = require('../utils/ErrorFormatter');

/**
 * @typedef {object} NtpReportResponseItem
 * @property {number} clock
 */

/**
 * @typedef {object} NtpServerStatus
 * @property {string} server
 * @property {string} type - "server", "peer", "local"
 * @property {string} status - "synced", "combined", "ignored"
 * @property {number} stratum
 */

class NtpClient {
  /**
   * @returns {Promise.<boolean>}
   */
  static async capable() {
    try {
      const distro = await Distro.getDistro();

      if (distro.centos) {
        await Shell.exec('systemctl', 'status', 'chronyd.service');
      }
      else if (distro.ubuntu) {
        await Shell.exec('systemctl', 'status', 'chrony.service');
      }
      else {
        throw new Error(`unrecognized distribution: ${JSON.stringify(distro)}`);
      }

      return true;
    }
    catch (err) {
      log.error(ErrorFormatter.format(err));
      return false;
    }
  }

  /**
   * @param {{db: LevelDb}} opts
   */
  constructor(opts) {

  }

  /**
   * @returns {NtpReportResponseItem}
   */
  tick() {
    return {
      clock: (new UTCClock()).now.ms()
    };
  }

  /**
   * @returns {Promise.<Array.<NtpServerStatus>>}
   */
  async server() {
    const lines = (await Shell.exec('chronyc', 'sources'))
      .split('\n')
      .map(x => x.trim())
      .filter(x => x.length > 0);

    let index = lines.findIndex(x => /^=+$/.test(x));

    if (index < 0) {
      throw new Error(`could not find a line containing ='s in chronyc response`);
    }

    return lines.slice(index + 1).map(line => {
      const parts = line.split(/\s+/);

      if (parts[0].length !== 2) {
        throw new Error(`could not parse type and status from line "${line}"`);
      }

      let type = parts[0].substr(0, 1);
      let status = parts[0].substr(1);

      if (type === '^') {
        type = 'server';
      }
      else if (type === '=') {
        type = 'peer';
      }
      else if (type === '#') {
        type = 'local';
      }
      else {
        throw new Error(`unknown ntp server type in line "${line}"`);
      }

      if (status === '*') {
        status = 'synced';
      }
      else if (status === '+') {
        status = 'combined';
      }
      else if (status === '-') {
        status = 'ignored';
      }
      else if (status === '?') {
        status = 'unreachable';
      }
      else if (status === 'x') {
        status = 'error-full'
      }
      else if (status === '~') {
        status = 'too-variable'
      }
      else {
        throw new Error(`unknown ntp server status in line "${line}"`);
      }

      return {
        server: parts[1],
        type: type,
        status: status,
        stratum: parseInt(parts[2])
      }
    });
  }

  /**
   * @returns {Promise.<boolean>}
   */
  async makeStep() {
    await Shell.exec('chronyc -a \'burst 4/4\'');
    await Sleep.nap(10000);
    await Shell.exec('chronyc -a makestep');

    return true;
  }
}

module.exports = NtpClient;
