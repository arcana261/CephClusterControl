"use strict";

const Shell = require('../utils/Shell');
const SizeParser = require('../utils/SizeParser');

class CephPoolClient {
  /**
   * @returns {Promise.<Array.<String>>}
   */
  async ls() {
    return (await Shell.exec('ceph', 'osd', 'lspools'))
      .split(',')
      .map(x => x.trim())
      .filter(x => x.length > 0)
      .map(x => {
        let idx = x.indexOf(' ');

        if (idx < 0) {
          return x;
        }
        else {
          return x.substr(idx + 1).trim();
        }
      });
  }

  /**
   * @param {string} pool
   * @returns {Promise.<number|null>}
   */
  async getQuota(pool) {
    const shellResponse = await Shell.exec('ceph', 'osd', 'pool', 'get-quota', pool);
    const lines = shellResponse.split('\n').map(x => x.trim());

    if (lines.length < 1 || lines[0] !== `quotas for pool '${pool}':`) {
      throw new Error(`unable to parse ceph response: ${shellResponse}`);
    }

    for (let line of lines.slice(1)) {
      if (line.startsWith('max bytes')) {
        line = line.substr('max bytes'.length).trim();

        if (!line.startsWith(':')) {
          throw new Error(`unable to parse ceph response: ${shellResponse}`);
        }

        line = line.substr(1).trim();

        if (line === 'N/A') {
          return null;
        }

        return SizeParser.parseMegabyte(line);
      }
    }

    throw new Error(`unable to parse ceph response: ${shellResponse}`);
  }

  /**
   * @param {string} pool
   * @param {number} size
   * @returns {Promise.<boolean>}
   */
  async setQuota(pool, size) {
    await Shell.exec('ceph', 'osd', 'pool', 'set-quota', pool, 'max_bytes', Math.floor(size * 1024 * 1024));
    return true;
  }

  /**
   * @param {string} name
   * @param {number} pgnum
   * @param {number} pgpnum
   * @returns {Promise.<boolean>}
   */
  async create(name, pgnum, pgpnum) {
    await Shell.exec('ceph', 'osd', 'pool', 'create', name, '' + pgnum, '' + pgpnum);
    return true;
  }

  /**
   * @param {string} name
   * @returns {Promise.<boolean>}
   */
  async del(name) {
    await Shell.exec('ceph', 'osd', 'pool', 'delete', name, name, '--yes-i-really-really-mean-it');
    return true;
  }

  /**
   * @returns {Promise.<Object.<String, {used: Number, objects: Number}>>}
   */
  async df() {
    const result = JSON.parse(await Shell.exec('ceph', 'df', '--format', 'json'));

    return result.pools.map(item => ({
      [item.name]: {
        used: item.stats.bytes_used / (1024*1024),
        objects: item.stats.objects
      }
    })).reduce((prev, cur) => Object.assign(prev, cur), {});
  }
}

module.exports = CephPoolClient;
