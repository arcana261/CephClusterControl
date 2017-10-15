"use strict";

/**
 * @typedef {object} IScsiIqn
 * @property {number} year
 * @property {number} month
 * @property {string} name
 * @property {string|null} host
 * @property {string|null} domain
 * @property {string} tag
 */

class IScsiUtils {
  /**
   * @param {string} str
   * @returns {IScsiIqn}
   */
  static parseIqn(str) {
    const orig = str;
    str = str.trim();

    if (!str.startsWith('iqn.')) {
      throw new Error(`iqn should start with iqn. "${orig}"`);
    }

    str = str.substr('iqn.'.length);

    let index = str.indexOf('.');

    if (index < 0) {
      throw new Error(`could not seperate year/month from iqn "${orig}"`);
    }

    const yearMonthPart = str.substr(0, index);
    str = str.substr(index + 1);

    if (!/\d{4}-\d{2}/.test(yearMonthPart)) {
      throw new Error(`bad year/month spec in iqn "${orig}"`);
    }

    index = yearMonthPart.indexOf('-');

    const year = parseInt(yearMonthPart.substr(0, index));
    const month = parseInt(yearMonthPart.substr(index + 1));

    index = str.indexOf(':');

    if (index < 0) {
      throw new Error(`could not locate ":" in iqn "${orig}"`);
    }

    const tag = str.substr(index + 1);
    str = str.substr(0, index);

    let name = null;
    let host = null;
    let domain = null;

    index = str.indexOf('.');

    if (index >= 0) {
      name = str.substr(0, index);
      str = str.substr(index + 1);

      index = str.lastIndexOf('.');

      if (index >= 0) {
        domain = str.substr(index + 1);
        host = str.substr(0, index);
      }
      else {
        host = str;
      }
    }
    else {
      name = str;
    }

    return {
      year: year,
      month: month,
      name: name,
      host: host,
      domain: domain,
      tag: tag
    };
  }

  /**
   * @param {IScsiIqn} iqn
   * @returns {string}
   */
  static stringifyIqn(iqn) {
    return `iqn.${NumberPadder.pad(iqn.year, 4)}-${NumberPadder.pad(iqn.month, 2)}.${iqn.name}` +
      `${iqn.host !== null ? `.${iqn.host}` : ''}${iqn.domain !== null ? `.${iqn.domain}` : ''}` +
      `:${iqn.tag}`;
  }
}

module.exports = IScsiUtils;
