"use strict";

const mkdirp = require('mkdirp');

class MkDir {
  /**
   * @returns {Promise.<void>}
   */
  static path(dir) {
    return new Promise((resolve, reject) => mkdirp(dir, err => {
      if (err) {
        reject(err);
      }
      else {
        resolve();
      }
    }));
  }
}

module.exports = MkDir;
