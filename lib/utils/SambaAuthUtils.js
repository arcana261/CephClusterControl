"use strict";

class SambaAuthUtils {
  /**
   * @param {string} str
   * @returns {SambaPermission}
   */
  static parsePermission(str) {
    str = str.toLowerCase();

    if (str === 'read') {
      return 2;
    }
    else if (str === 'write') {
      return 3;
    }
    else if (str === 'denied') {
      return 0;
    }
    else {
      throw new Error(`samba auth permission syntax error: ${str}`);
    }
  }

  /**
   *
   * @param {SambaPermission} perm
   * @returns {string}
   */
  static stringifyPermission(perm) {
    if (perm === 2) {
      return 'read';
    }
    else if (perm === 3) {
      return 'write';
    }
    else if (perm === 0) {
      return 'denied';
    }
    else {
      throw new Error(`bad samba permission: ${perm}`);
    }
  }
}

module.exports = SambaAuthUtils;




