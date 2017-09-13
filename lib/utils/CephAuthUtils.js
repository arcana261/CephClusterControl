"use strict";

class CephAuthUtils {
  /**
   * @param {string} perm
   * @returns {number}
   */
  static parsePermission(perm) {
    let orig = perm;

    perm = perm.trim();

    if (perm === '*') {
      return 8;
    }

    let r = perm.startsWith('r');

    if (r) {
      perm = perm.substr(1);
    }

    let w = perm.startsWith('w');

    if (w) {
      perm = perm.substr(1);
    }

    let x = perm.startsWith('x');

    if (x) {
      perm = perm.substr(1);
    }

    if (perm) {
      throw new Error(`unable to convert string to ceph auth permission: "${orig}"`);
    }

    return (r ? 4 : 0) + (w ? 2 : 0) + (x ? 1 : 0);
  }

  /**
   * @param {number} perm
   * @returns {string}
   */
  static stringifyPermission(perm) {
    if (perm === 8) {
      return '*';
    }
    else if (perm === 0) {
      return '';
    }
    else {
      return `${(perm & 4) !== 0 ? 'r' : ''}${(perm & 2) !== 0 ? 'w' : ''}${(perm & 1) !== 0 ? 'x' : ''}`;
    }
  }

  /**
   * @param {CephCapItem} capItem
   * @returns {string}
   * @private
   */
  static _stringifyCapItem(capItem) {
    return `allow${capItem.permission !== 0 ? ` ${CephAuthUtils.stringifyPermission(capItem.permission)}` : ''}${capItem.profile ? ` ${capItem.profile}` : ''}${capItem.pool ? ` pool=${capItem.pool}` : ''}`;
  }


  /**
   * @param {CephEntityCaps} caps
   */
  static stringifyEntityCaps(caps) {
    return caps.map(x => CephAuthUtils._stringifyCapItem(x)).join(', ');
  }

  /**
   * @param {string} cap
   * @returns {CephCapItem}
   * @private
   */
  static _parseCapStringItem(cap) {
    cap = cap.trim();

    if (cap === 'allow') {
      return {
        permission: 0,
        profile: null,
        pool: null
      };
    }

    if (!cap.startsWith('allow')) {
      throw new Error(`failed to parse cap string item: "${cap}"`);
    }

    cap = cap.substr('allow '.length).trim();

    let pool = null;
    let profile = null;
    let permission = 0;
    let index = cap.indexOf('pool=');

    if (index >= 0) {
      pool = cap.substr(index + 'pool='.length).trim();
      cap = cap.substr(0, index).trim();
    }

    if (cap.startsWith('profile')) {
      profile = cap.substr('profile'.length).trim();
    }
    else {
      permission = CephAuthUtils.parsePermission(cap);
    }

    return {
      permission: permission,
      pool: pool,
      profile: profile
    };
  }

  /**
   * @param {string} cap
   * @return {CephEntityCaps}
   */
  static parseEntityCaps(cap) {
    return cap.split(',').map(x => CephAuthUtils._parseCapStringItem(x));
  }

  /**
   * @param {number} perm
   * @param {number} required
   * @returns {boolean}
   * @private
   */
  static _checkPermissionNumber(perm, required) {
    if (required === 0) {
      return true;
    }
    else if (perm === 8) {
      return true;
    }
    else if (required === 8) {
      return perm === 7;
    }
    else {
      return (perm & required) !== 0;
    }
  }

  /**
   * @param {CephEntityCaps} caps
   * @param {CephCapItem} required
   * @returns {boolean}
   * @private
   */
  static _checkEntityPermission(caps, required) {
    return caps.some(cap => {
      if (!CephAuthUtils._checkPermissionNumber(cap.permission, required.permission)) {
        return false;
      }

      if (cap.profile !== required.profile) {
        return false;
      }

      return cap.pool === null || cap.pool === required.pool;
    });
  }

  /**
   * @param {CephCaps} caps
   * @param {CephCaps} required
   * @returns {boolean}
   */
  static checkPermission(caps, required) {
    return Object.entries(required).every(
      entry => entry[1].every(req => CephAuthUtils._checkEntityPermission(caps[entry[0]], req)));
  }
}

module.exports = CephAuthUtils;
