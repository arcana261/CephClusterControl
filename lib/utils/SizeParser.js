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

    if (word === 'mb' || word === 'm' || word === 'mib') {
      return 1;
    }
    else if (word === 'kb' || word === 'k' || word === 'kib') {
      return (1/1024);
    }
    else if (word === 'gb' || word === 'g' || word === 'gib') {
      return 1024;
    }
    else if (word === 'tb' || word === 't' || word === 'tib') {
      return 1024*1024;
    }
    else if (word === 'b' || word === '') {
      return (1/(1024*1024));
    }

    throw new Error(`unrecognized size coefficient: ${word}`);
  }

  /**
   * @param {String} str
   * @returns {Number}
   */
  static parseMegabyte(str) {
    if (!/^\s*(\d+|\d*\.\d+)\s*\w{0,3}\s*$/.test(str)) {
      throw new Error(`input is not in correct format: ${str}`);
    }

    str = str.trim();

    let word = '';

    while (str.length > 0) {
      let part = str.substr(str.length - 1);

      if (/\D/.test(part) || part === '.') {
        word = part + word;
        str = str.substr(0, str.length - 1);
      }
      else {
        break;
      }
    }

    return Number(str) * SizeParser._wordToCoef(word.trim());
  }

  /**
   * @param {Number} value
   * @param {String} unit
   * @returns {String}
   */
  static stringify(value, unit = 'mb') {
    value = value * SizeParser._wordToCoef(unit);
    unit = 'MB';

    if (value < 1) {
      value = value * 1024;
      unit = 'KB';

      if (value < 1) {
        value = value * 1024;
        unit = 'B';
      }
    }
    else if (value > 1000) {
      value = value / 1024;
      unit = 'GB';

      if (value > 1000) {
        value = value / 1024;
        unit = 'TB';
      }
    }

    const numericPart = Math.floor(value);
    const floatPart = Math.floor((value - Math.floor(value)) * 100);

    if (floatPart < 1) {
      if (numericPart < 1) {
        return '0 MB';
      }
      else {
        return `${numericPart} ${unit}`;
      }
    }
    else {
      return `${numericPart}.${floatPart} ${unit}`;
    }
  }
}

module.exports = SizeParser;
