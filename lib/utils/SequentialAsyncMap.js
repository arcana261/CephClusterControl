"use strict";

class SequentialAsyncMap {
  /**
   * @param {Array.<T>} items
   * @param {function(T=, number=, Array.<T>=):Promise.<E>} cb
   * @returns {Promise.<Array.<E>>}
   * @template T
   * @template E
   */
  static async map(items, cb) {
    const result = [];
    let index = 0;

    for (const item of items) {
      result.push(await cb(item, index++, items));
    }

    return result;
  }
}

module.exports = SequentialAsyncMap;
