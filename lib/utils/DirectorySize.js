"use strict";

const fs = require('mz/fs');
const path = require('path');

class DirectorySize {
  /**
   * @param {string} dir
   * @returns {Promise.<number>}
   */
  static async find(dir) {
    if (!(await fs.exists(dir))) {
      throw new Error(`target path: "${dir}" does not exist`);
    }

    const stat = await fs.lstat(dir);

    if (stat.isDirectory()) {
      return (await Promise.all(
        (await fs.readdir(dir)).map(item => DirectorySize.find(path.join(dir, item)))))
        .reduce((prev, cur) => prev + cur, 0);
    }
    else {
      return stat.size / (1024 * 1024);
    }
  }
}

module.exports = DirectorySize;
