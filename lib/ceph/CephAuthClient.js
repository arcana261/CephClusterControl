"use strict";

const Shell = require('../utils/Shell');
const CephAuthUtils = require('../utils/CephAuthUtils');

/**
 * @typedef {object} CephCapItem
 * @property {Number} permission
 * @property {String|null} pool
 * @property {String|null} profile
 */

/**
 * @typedef {Array.<CephCapItem>} CephEntityCaps
 */

/**
 * @typedef {object} CephCaps
 * @property {CephEntityCaps} mon
 * @property {CephEntityCaps} mds
 * @property {CephEntityCaps} osd
 */

/**
 * @typedef {object} CephAuthEntry
 * @property {String|null} key
 * @property {CephCaps} caps
 */

/**
 * @typedef {Object.<String, CephAuthEntry>} CephAuthList
 */

class CephAuthClient {
  /**
   * @returns {Promise.<CephAuthList>}
   */
  async ls() {
    const shellResponse = await Shell.exec('ceph', 'auth', 'list');
    const lines = shellResponse.split('\n').map(x => x.trim());

    if (lines.length > 0 && lines[0] === 'installed auth entries:') {
      lines.splice(0, 1);
    }

    let response = {};
    let name = null;
    let key = null;
    let caps = null;

    for (let line of lines) {
      if (line.startsWith('key:')) {
        key = line.substr('key:'.length).trim();
      }
      else if (line.startsWith('caps:')) {
        line = line.substr('caps:'.length).trim();
        const index = line.indexOf(']');

        if (!line.startsWith('[') || index < 0) {
          throw new Error(`failed to parse shell output: ${shellResponse}`);
        }

        const capsKey = line.substring(1, index);
        line = line.substr(index + 1);

        if (['mds' , 'mon', 'osd'].indexOf(capsKey) < 0) {
          throw new Error(`failed to parse shell output: ${shellResponse}`);
        }

        caps[capsKey] = caps[capsKey].concat(CephAuthUtils.parseEntityCaps(line));
      }
      else {
        if (name !== null) {
          response[name] = {
            key: key,
            caps: caps
          };
        }

        name = line;
        key = null;
        caps = {
          mon: [],
          osd: [],
          mds: []
        };
      }
    }

    return response;
  }

  /**
   * @param {CephCaps} caps
   * @returns {string}
   * @private
   */
  _capsToString(caps) {
    let x = Object.entries(caps)
      .map(([entity, entityCaps]) =>
        entityCaps.length > 0 ? `${entity} '${CephAuthUtils.stringifyEntityCaps(entityCaps)}'` : '')
      .join(' ');

    console.log(x);

    return x;
  }

  /**
   * @param {string} client
   * @param {CephCaps} caps
   * @returns {Promise.<void>}
   * @private
   */
  async _create(client, caps) {
    await Shell.exec('ceph', 'auth', 'get-or-create', client, this._capsToString(caps));
  }

  /**
   * @param {string} client
   * @param {CephCaps} caps
   * @returns {Promise.<void>}
   * @private
   */
  async _update(client, caps) {
    await Shell.exec('ceph', 'auth', 'caps', client, this._capsToString(caps));
  }

  /**
   * @param {string} client
   * @param {CephCaps} caps
   * @returns {Promise.<boolean>}
   */
  async add(client, caps) {
    const auth = await this.ls();

    console.log(caps);

    if (client in auth) {
      await this._update(client, caps);
    }
    else {
      await this._create(client, caps);
    }

    return true;
  }

  /**
   * @param client
   * @returns {Promise.<String>}
   */
  get(client) {
    return Shell.exec('ceph', 'auth', 'get', client);
  }

  /**
   * @param {string} client
   * @returns {Promise.<boolean>}
   */
  async del(client) {
    await Shell.exec('ceph', 'auth', 'del', client);
    return true;
  }
}

module.exports = CephAuthClient;
