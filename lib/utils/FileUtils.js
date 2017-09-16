"use strict";

const copy = require('copy');

class FileUtils {
  /**
   * @param {string} src
   * @param {string} dst
   * @returns {Promise.<void>}
   */
  static copyFile(src, dst) {
    return new Promise((resolve, reject) => {
      copy(src, dst, (err, files) => {
        if (err) {
          reject(err);
        }
        else {
          resolve();
        }
      });
    });
  }
}

module.exports = FileUtils;
