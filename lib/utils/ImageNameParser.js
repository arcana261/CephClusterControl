"use strict";

class ImageNameParser {
  /**
   * @param {String} str
   * @param {String} defaultPool
   * @returns {{pool: String, image: String, fullName: String}}
   */
  static parse(str, defaultPool = '*') {
    str = str.trim();

    if (!/^[\w\-]+(\/[\w\-]+)?$/.test(str)) {
      throw new Error(`image name format error: ${str}`);
    }

    let idx = str.indexOf('/');

    if (idx >= 0) {
      return {
        pool: str.substr(0, idx),
        image: str.substr(idx + 1),
        fullName: str
      }
    }
    else {
      if (defaultPool === '*') {
        defaultPool = 'rbd';
      }

      return {
        pool: defaultPool,
        image: str,
        fullName: `${defaultPool}/${str}`
      }
    }
  }
}

module.exports = ImageNameParser;
