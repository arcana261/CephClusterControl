"use strict";

const crypto = require('crypto');

class PasswordHash {
  /**
   * @param {string} str
   * @returns {Promise.<string>}
   */
  static create(str) {
    return new Promise((resolve, reject) => {
      try {
        const hash = crypto.createHash('sha512');
        hash.update(str);
        resolve(hash.digest('base64'));
      }
      catch (err) {
        reject(err);
      }
    });
  }

  /**
   * @param {string} hash
   * @param {string} password
   * @returns {Promise.<boolean>}
   */
  static async verify(hash, password) {
    const expected = await PasswordHash.create(password);
    return expected === hash;
  }
}

module.exports = PasswordHash;
