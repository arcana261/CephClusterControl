"use strict";

const typeCheck = require('type-check').typeCheck;
const fs = require('mz/fs');

/**
 * @typedef {Object.<string, Object.<string, *>>} EtcSetting
 */

class EtcParser {
  /**
   * @param {string} str
   * @returns {Array.<string>}
   * @private
   */
  static _splitValue(str) {
    const result = [];
    let index = -1;
    let position = 0;

    while((index = str.indexOf(',', position)) >= 0) {
      if (index === 0) {
        result.push('');
        str = str.substr(1);
        position = 0;
      }
      else if (str.charAt(index - 1) !== '\\') {
        result.push(str.substr(0, index).trim());
        str = str.substr(index + 1);
        position = 0;
      }
      else {
        position = index + 1;
      }
    }

    result.push(str.trim());

    return result;
  }

  /**
   * @param {string} str
   * @param {string} section
   * @param {string} key
   * @param {string} line
   * @returns {number}
   * @private
   */
  static _readNumber(str, section, key, line) {
    const result = Number(str);

    if (Number.isNaN(result)) {
      throw new Error(`failed to read [number] from "${str}" for section ${section}, key ${key} in line ${line}`);
    }

    return result;
  }

  /**
   * @param {*} sample
   * @param {string} str
   * @param {string} section
   * @param {string} key
   * @returns {*}
   * @private
   */
  static _parseValue(sample, str, section, key) {
    const split = this._splitValue(str);

    if (typeCheck('Number', sample)) {
      return EtcParser._readNumber(split[split.length - 1], section, key, str);
    }
    else if (typeCheck('String', sample)) {
      if (split.length < 1) {
        throw new Error(`failed to read [string] for section ${section}, key ${key} in line ${str}`);
      }

      return split[split.length - 1];
    }
    else if (typeCheck('[Number]', sample)) {
      return split.map(x => EtcParser._readNumber(x, section, key, str));
    }
    else if (typeCheck('[String]', sample)) {
      return split;
    }
    else {
      return split;
    }
  }

  /**
   * @param {string} str
   * @param {string} section
   * @returns {[string, string]}
   * @private
   */
  static _parseKeyValuePair(str, section) {
    let index = -1;
    let position = 0;

    while (index < 0) {
      index = str.indexOf('=', position);

      if (index < 0) {
        break;
      }
      else if (index > 0 && str.charAt(index - 1) === '\\') {
        position = index + 1;
        index = -1;
      }
    }

    if (index < 0) {
      throw new Error(`could not detect [=] sign in line "${str}" for section "${section}"`);
    }

    return [str.substr(0, index).trim(), str.substr(index + 1).trim()];
  }

  /**
   * @param {string} content
   * @returns {Array.<{key: string, lines: Array.<string>}>}
   * @private
   */
  static _groupContentIntoSections(content) {
    return content.split('\n')
      .map(x => x.trim().replace(/[#;].*$/g, ''))
      .filter(x => x.length > 0)
      .reduce((prev, line) => {
        if (line.startsWith('[') && line.endsWith(']')) {
          prev.push({
            key: line.substr(1, line.length - 2).trim(),
            lines: []
          });
        }
        else {
          if (prev.length < 1) {
            throw new Error(`orphan line "${line}"`);
          }

          prev[prev.length - 1].lines.push(line);
        }

        return prev;
      }, []);
  }

  /**
   * @param {EtcSetting|null} defaultValues
   * @param {string} content
   * @returns {EtcSetting}
   * @private
   */
  static _parseContent(defaultValues, content) {
    defaultValues = defaultValues || {};

    return Object.assign({}, defaultValues,
      EtcParser._groupContentIntoSections(content)
        .map(section => {
          const sectionDefaultValues = defaultValues[section.key] || {};

          return {
            [section.key]:
              Object.assign({}, sectionDefaultValues,
                section.lines.map(line => {
                const [key, value] = EtcParser._parseKeyValuePair(line, section.key);

                return {
                  [key]: EtcParser._parseValue(sectionDefaultValues[key], value, section.key, key)
                };
              }).reduce((prev, cur) => Object.assign(prev, cur), {}))
          };
        }).reduce((prev, cur) => Object.assign(prev, cur), {}));
  }

  /**
   * @param {string} path
   * @param {EtcSetting|null} defaultValues
   * @returns {Promise.<EtcSetting>}
   */
  static async read(path, defaultValues = null) {
    return EtcParser._parseContent(defaultValues, await fs.readFile(path, 'utf8'));
  }

  /**
   * @param {string} path
   * @param {EtcSetting|null} defaultValues
   * @returns {EtcSetting}
   */
  static readSync(path, defaultValues = null) {
    return EtcParser._parseContent(defaultValues, require('fs').readFileSync(path, 'utf8'));
  }
}

module.exports = EtcParser;

