"use strict";

class VersionComparer {
  /**
   * @param {string} ver1
   * @param {string} ver2
   * @returns {number}
   */
  static compare(ver1, ver2) {
    const left = ver1.split('.');
    const right = ver2.split('.');

    let i = 0;
    let j = 0;

    while (i < left.length && j < right.length) {
      const x = left[i].length > 0 ? parseInt(left[i]) : 0;
      const y = right[j].length > 0 ? parseInt(right[j]) : 0;

      if (x < y) {
        return -1;
      }
      else if (y < x) {
        return 1;
      }

      i = i + 1;
      j = j + 1;
    }

    if (i < left.length) {
      return -1;
    }

    if (j < right.length) {
      return 1;
    }

    return 0;
  }
}

module.exports = VersionComparer;
