"use strict";

const TmpDir = require('../utils/TmpDir');
const MkDir = require('../utils/MkDir');
const uuid = require('uuid/v4');
const path = require('path');
const Distro = require('../utils/Distro');
const Shell = require('../utils/Shell');
const MultipartServer = require('../multipart');
const log = require('logging').default('UpdaterServer');
const ErrorFormatter = require('../utils/ErrorFormatter');
const PackageJson = require('../../package.json');
const fs = require('mz/fs');
const DirectoryCleaner = require('../utils/DirectoryCleaner');

/**
 * @typedef {object} _UpdaterStatusResponse
 * @property {string} version
 * @property {DistroObject} distro
 */

class UpdaterServer {
  /**
   * @returns {Promise.<boolean>}
   */
  static async capable() {
    try {
      return await MultipartServer.capable();
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
   * @returns {Promise.<string>}
   */
  async generatePath() {
    const distro = await Distro.getDistro();
    let ext = null;

    if (distro.ubuntu) {
      ext = 'deb';
    }
    else if (distro.centos) {
      ext = 'rpm';
    }
    else {
      throw new Error(`unknown distro: ${JSON.stringify(distro)}`);
    }

    const targetDir = path.join(TmpDir, 'kaveh-updater', uuid());
    await MkDir.path(targetDir);

    return path.join(targetDir, `update.${ext}`);
  }

  /**
   * @param {string} filePath
   * @returns {Promise.<String>}
   */
  async getPackageVersion(filePath) {
    const ext = path.extname(filePath);
    const distro = await Distro.getDistro();

    if (ext === '.deb') {
      if (!distro.ubuntu) {
        throw new Error(`package version of *.deb files can be queries on ubuntu agents`);
      }

      return (await Shell.exec('dpkg-deb', '-f', `"${filePath}"`, 'Version')).trim();
    }
    else if (ext === '.rpm') {
      if (!distro.centos) {
        throw new Error(`package version of *.rpm files can be queries on centos agents`);
      }

      const result = await Shell.exec(`rpm -qip "${filePath}" | grep Version`);
      const index = result.indexOf(':');

      if (index < 0) {
        throw new Error(`failed to process rpm version from line "${result}"`);
      }

      return result.substr(index + 1).trim();
    }
    else {
      throw new Error(`unknown package extension: "${filePath}"`);
    }
  }

  /**
   * @param {string} filePath
   * @returns {Promise.<boolean>}
   */
  async update(filePath) {
    const distro = await Distro.getDistro();
    let cmd = null;

    if (distro.ubuntu) {
      cmd = `dpkg -i "${filePath}"`;
    }
    else if (distro.centos) {
      cmd = `yum localinstall -y "${filePath}"`;
    }
    else {
      throw new Error(`unknown distro: ${JSON.stringify(distro)}`);
    }

    const batchDir = path.join(TmpDir, 'kaveh-updater');
    await MkDir.path(batchDir);
    const batchFile = path.join(batchDir, 'batch.sh');

    await fs.writeFile(batchFile, cmd + '\n\n');
    await Shell.exec('at', '-f', `"${batchFile}"`, '"now + 1 minute"');

    return true;
  }

  /**
   * @returns {Promise.<_UpdaterStatusResponse>}
   */
  async status() {
    return {
      version: PackageJson.version,
      distro: await Distro.getDistro()
    };
  }

  /**
   * @returns {Promise.<void>}
   */
  cleanupTempFolder() {
    return DirectoryCleaner.clean(path.join(TmpDir, 'kaveh-updater'), 7);
  }
}

module.exports = UpdaterServer;
