"use strict";

const path = require('path');
const fs = require('mz/fs');
const MultipartProxy = require('../multipart');
const VersionComparer = require('../../utils/VersionComparer');
const Sleep = require('../../utils/Sleep');

/**
 * @callback UpdateReportCallback
 * @param {UpdateReport} report
 */

/**
 * @typedef {object} UpdateReport
 * @property {number} size
 * @property {string} path
 * @property {string|null} version
 * @property {string} target - can be one of ['ubuntu', 'centos']
 * @property {Array.<UpdateReportItem>} hosts
 */

/**
 * @typedef {object} UpdateReportItem
 * @property {string} hostname
 * @property {string} version
 * @property {boolean} applicable
 * @property {DistroObject} distro
 * @property {number} transferred
 * @property {number} speed
 * @property {string} status - one of ['initializing', 'incompatible', 'newer', 'uploading', 'upgrading', 'done']
 */

class UpdaterProxy {
  /**
   * @param {ClientLoop} client
   */
  constructor(client) {
    this._client = client;
    this._scp = new MultipartProxy(client);
  }

  get client() {
    return this._client;
  }

  /**
   * @returns {Promise.<WorkerInfoResponse>}
   */
  hosts() {
    return this._client.listHostsForType('updater');
  }

  /**
   * @param {string} host
   * @returns {Promise.<string>}
   * @private
   */
  _generatePath(host) {
    return this._client.call('updater', host, 'updater.generatePath', []);
  }

  /**
   * @param {string} host
   * @returns {Promise.<_UpdaterStatusResponse>}
   * @private
   */
  _status(host) {
    return this._client.call('updater', host, 'updater.status', []);
  }

  /**
   * @param {string} host
   * @param {string} filePath
   * @returns {Promise.<string>}
   * @private
   */
  _getPackageVersion(host, filePath) {
    return this._client.call('updater', host, 'updater.getPackageVersion', [filePath]);
  }

  /**
   * @param {string} host
   * @param {string} filePath
   * @returns {Promise.<void>}
   * @private
   */
  async _update(host, filePath) {
    const result = await this._client.call('updater', host, 'updater.update', [filePath], {timeout: -1});

    if (!result) {
      throw new Error('unknown error occurred during operation: false');
    }
  }

  /**
   * @param {string} filePath
   * @param {Array.<string>|null} hosts
   * @returns {Promise.<UpdateReport>}
   * @private
   */
  async _initializeReport(filePath, hosts = null) {
    const size = (await fs.lstat(filePath)).size / (1024 * 1024);
    const ext = path.extname(filePath);
    let target = null;

    if (ext === '.deb') {
      target = 'ubuntu';
    }
    else if (ext === '.rpm') {
      target = 'centos';
    }
    else {
      throw new Error(`unsupported package extension: "${filePath}"`);
    }

    if (hosts === null) {
      hosts = (await this.hosts()).map(x => x.hostname);
    }

    return {
      size: size,
      path: filePath,
      version: null,
      target: target,
      hosts: await Promise.all(hosts.map(async host => {
        const status = await this._status(host);
        let applicable = false;

        if (ext === '.deb') {
          applicable = status.distro.ubuntu;
        }
        else if (ext === '.rpm') {
          applicable = status.distro.centos;
        }
        else {
          throw new Error(`unsupported package extension: "${filePath}"`);
        }

        return {
          hostname: host,
          version: status.version,
          applicable: applicable,
          distro: status.distro,
          transferred: 0,
          speed: 0,
          status: applicable ? 'initializing' : 'incompatible'
        };
      }))
    };
  }

  /**
   * @param {UpdateReport} report
   * @param {number} index
   * @param {boolean} downgrade
   * @param {UpdateReportCallback|null} cb
   * @returns {Promise.<void>}
   * @private
   */
  async _updateHost(report, index, downgrade, cb) {
    const item = report.hosts[index];
    let cancel = false;

    if (item.applicable) {
      const targetPath = await this._generatePath(item.hostname);

      try {
        await this._scp.send(report.path, item.hostname, targetPath, async newFile => {
        }, (speed, transferred) => {
          item.transferred = transferred;
          item.speed = speed;
          item.status = 'uploading';

          if (cb !== null) {
            cb(report);
          }

          if (!downgrade && report.version !== null && VersionComparer.compare(report.version, item.version) <= 0) {
            item.status = 'newer';

            if (cb !== null) {
              cb(report);
            }

            cancel = true;
            throw new Error('operation canceled');
          }
        });
      }
      catch (err) {
        if (!cancel) {
          throw err;
        }
      }

      if (!cancel) {
        item.transferred = report.size;
        item.status = 'upgrading';

        if (cb !== null) {
          cb(report);
        }

        if (report.version === null) {
          if ((report.target === 'ubuntu' && item.distro.ubuntu) ||
            (report.target === 'centos' && item.distro.centos)) {

            report.version = await this._getPackageVersion(item.hostname, targetPath);

            if (cb !== null) {
              cb(report);
            }
          }
          else {
            while (report.version === null) {
              await Sleep.nap(1000);
            }
          }
        }

        if (!downgrade && VersionComparer.compare(report.version, item.version) <= 0) {
          item.status = 'newer';

          if (cb !== null) {
            cb(report);
          }
        }
        else {
          await this._update(item.hostname, targetPath);

          let done = false;
          while (!done) {
            try {
              done = (await this._status(item.hostname)).version === report.version;
            }
            catch (err) {
            }
          }

          item.status = 'done';
          const status = await this._status(item.hostname);
          item.version = status.version;

          if (cb !== null) {
            cb(report);
          }
        }
      }
    }
  }

  /**
   * @param {string} filePath
   * @param {UpdateReportCallback} cb
   * @param {boolean} downgrade
   * @param {Array.<string>|null} hosts
   * @returns {Promise.<void>}
   */
  async update(filePath, cb = null, downgrade = false, hosts = null) {
    const report = await this._initializeReport(filePath, hosts);

    if (cb !== null) {
      cb(report);
    }

    await Promise.all(report.hosts.map((item, index) => this._updateHost(report, index, downgrade, cb)));
  }
}

module.exports = UpdaterProxy;
