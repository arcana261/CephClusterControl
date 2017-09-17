"use strict";

class Sleep {
  /**
   * @param {number} ms
   * @returns {Promise.<void>}
   */
  static nap(ms) {
    return new Promise((resolve, reject) => setTimeout(resolve, ms));
  }
}

module.exports = Sleep;
