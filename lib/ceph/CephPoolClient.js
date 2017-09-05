"use strict";

const Shell = require('../utils/Shell');

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
}

module.exports = CephPoolClient;
