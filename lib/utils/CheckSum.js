"use strict";

const checksum = require('checksum');
const crypto = require('crypto');
const fs = require('mz/fs');

class CheckSum {
  /**
   * @param {Buffer} buff
   * @returns {string}
   */
  static fromBuffer(buff) {
    const hash = crypto.createHash('sha1');
    hash.update(buff);
    return hash.digest('base64')
  }

  /**
   * @param {Buffer} buff
   * @returns {string}
   */
  static fromBufferOld(buff) {
    return checksum(buff);
  }

  /**
   * @param {string} path
   * @returns {Promise.<string>}
   */
  static async fromFile(path) {
    const hash = crypto.createHash('sha1');
    const buffer = new Buffer(1024);
    let done = false;
    let offset = 0;

    const handle = await fs.open(path, 'r');

    try {
      while (!done) {
        const [bytesRead] = await fs.read(handle, buffer, 0, 1024, offset);

        if (bytesRead !== 1024) {
          done = true;
          hash.update(buffer.slice(0, bytesRead));
        }
        else {
          hash.update(buffer);
          offset += bytesRead;
        }
      }
    }
    catch (err) {
      console.log(err);
      try {
        await fs.close(handle);
      }
      catch (err2) {
      }

      throw err;
    }

    await fs.close(handle);

    return hash.digest('base64');
  }
}

module.exports = CheckSum;
