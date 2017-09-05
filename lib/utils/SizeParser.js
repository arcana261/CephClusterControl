"use strict";

const typeCheck = require('type-check').typeCheck;

class SizeParser {
  /**
   * @param {String} word
   * @returns {Number}
   * @private
   */
  static _wordToCoef(word) {
    word = word.toLowerCase();

    if (word === 'mb' || word === 'm') {
      return 1;
    }
    else if (word === 'kb' || word === 'k') {
      return 1e-3;
    }
    else if (word === 'gb' || word === 'g') {
      return 1e3;
    }
    else if (word === 'tb' || word === 't') {
      return 1e6;
    }
    else if (word === 'b' || word === '') {
      return 1e-6;
    }

    throw new Error(`unrecognized size coefficient: ${word}`);
  }

  /**
   * @param {String} str
   * @returns {Number}
   */
  static parseMegabyte(str) {
    if (!/^\s*\d+\s*\w{0,2}\s*$/.test(str)) {
      throw new Error(`input is not in correct format: ${str}`);
    }

    str = str.trim();

    let word = '';

    while (str.length > 0) {
      let part = str.substr(str.length - 1);

      if (/\D/.test(part)) {
        word = part + word;
        str = str.substr(0, str.length - 1);
      }
      else {
        break;
      }
    }

    return parseInt(str) * SizeParser._wordToCoef(word.trim());
  }
}

module.exports = SizeParser;
