"use strict";

const Shell = require('../utils/Shell');
const SizeParser = require('../utils/SizeParser');

class IScsiClient {
  /**
   * @returns {Promise.<Array.<{name: string, path: string, size: number}>>}
   * @private
   */
  async _parseBackStores() {
    const shellResponse = await Shell.exec('targetcli', '"ls /backstores/fileio 1"');
    const lines = shellResponse.split('\n').map(x => x.trim()).filter(x => x.length > 0);

    if (lines.length < 1) {
      throw new Error(`can not parse targetcli response: ${shellResponse}`);
    }

    if (!/o-\s+fileio\s*\.*\s*\[Storage Objects:\s*\d+]/.test(lines[0])) {
      throw new Error(`could not parse first line from response: ${line[0]}`);
    }

    return lines.slice(1).map(line => {
      if (!line.startsWith('o-')) {
        throw new Error(`could not parse line: ${line}`);
      }

      line = line.substr('o-'.length).trim();

      let index = line.indexOf(' ');

      if (index < 0) {
        throw new Error(`could not parse line: ${line}`);
      }

      const name = line.substr(0, index).trim();
      line = line.substr(index + 1).trim();

      index = line.indexOf('[');

      if (index < 0) {
        throw new Error(`could not parse line: ${line}`);
      }

      line = line.substr(index + 1).trim();

      const parts = line.split(' ', 2);

      if (parts.length !== 2) {
        throw new Error(`could not parse line: ${line}`);
      }

      if (!parts[1].startsWith('(') || !parts[1].endsWith(')')) {
        throw new Error(`could not parse line: ${line}`);
      }

      if (!/^(\/[^ \/])+\/?/.test(parts[0])) {
        throw new Error(`could not parse line: ${line}`);
      }

      return {
        name: name,
        path: parts[0],
        size: SizeParser.parseMegabyte(parts[1].substr(1, parts[1].length - 2))
      };
    });
  }
}

module.exports = IScsiClient;
