"use strict";

const TmpDir = require('./TmpDir');
const uuid = require('uuid/v4');
const path = require('path');
const MkDir = require('./MkDir');
const fs = require('mz/fs');

class LocalToken {
  /**
   * @returns {Promise.<void>}
   */
  static async generateNew() {
    const dir = path.join(TmpDir, 'kaveh-agent-token');
    await MkDir.path(dir);

    const fileName = path.join(dir, 'token.conf');
    await fs.writeFile(fileName, uuid());
  }

  /**
   * @returns {Promise.<string>}
   */
  static async read() {
    try {
      const fileName = path.join(TmpDir, 'kaveh-agent-token', 'token.conf');
      return await fs.readFile(fileName, 'utf8');
    }
    catch (err) {
      return '';
    }
  }
}

module.exports = LocalToken;
