"use strict";

const Shell = require('./Shell');

/**
 * @typedef {Array.<IpAddressItem>} IpAddressList
 */

/**
 * @typedef {object} IpAddressItem
 * @property {string} device
 * @property {string} state
 * @property {string} mac
 * @property {number} mtu
 * @property {string} etherBroadcast
 * @property {Array.<INetSpecification>} ipv4
 */

/**
 * @typedef {object} INetSpecification
 * @property {string} address
 * @property {number} prefix
 * @property {string|null} broadcast
 * @property {string|null} label
 */

class Ethernets {
  /**
   * @returns {Promise.<IpAddressList>}
   */
  static async ls() {
    return (await Shell.exec('ip', 'addr', 'show'))
      .split('\n')
      .map(x => x.trim())
      .filter(x => x.length > 0)
      .reduce((prev, cur) => {
        if (/^\d+:/.test(cur)) {
          prev.push([cur]);
          return prev;
        }
        else {
          prev[prev.length - 1].push(cur);
          return prev;
        }
      }, []).map(item => {
        const colonParts = item[0].split(':');

        if (colonParts.length !== 3) {
          throw new Error(`expected 2 colon in line "${item[0]}"`);
        }

        let device = colonParts[1].trim();
        let index = device.indexOf('@');
        if (index >= 0) {
          device = device.substr(0, index);
        }

        index = colonParts[2].indexOf('>');

        if (index < 0) {
          throw new Error(`expected characters <, > in line "${colonParts[2]}"`);
        }

        const params = colonParts[2].substr(index + 1).split(' ');

        index = params.indexOf('mtu');

        if (index < 0 || (index + 1) >= params.length) {
          throw new Error(`failed to locate mtu in line "${item[0]}"`);
        }

        const mtu = parseInt(params[index + 1]);

        index = params.indexOf('state');

        if (index < 0 || (index + 1) >= params.length) {
          throw new Error(`failed to locate device state in line "${item[0]}"`);
        }

        const state = params[index + 1].toLowerCase();

        const ether = item.slice(1).filter(x => x.startsWith('link/'))[0];

        if (!ether) {
          throw new Error(`unable to locate MAC address for device "${device}"`);
        }

        const etherParts = ether.split(' ');

        if (etherParts.length < 4) {
          throw new Error(`unable to locate MAC address for device "${device}"`);
        }

        const mac = etherParts[1];

        index = etherParts.indexOf('brd');

        if (index < 0 || (index + 1) >= etherParts.length) {
          throw new Error(`unable to locate ethernet broadcast for device "${device}"`);
        }

        const etherBroadcast = etherParts[index + 1];

        const ipv4 = item.slice(1)
          .filter(x => x.startsWith('inet '))
          .map(inet => {
            const parts = inet.split(' ');
            const ipPart = parts[1];

            let idx = ipPart.indexOf('/');

            if (idx < 0) {
              throw new Error(`unable to read ip address for device "${device}" in part "${inet}"`);
            }

            const ip = ipPart.substr(0, idx);
            const prefix = parseInt(ipPart.substr(idx + 1));

            idx = parts.indexOf('brd');

            let broadcast = null;

            if (idx >= 0 && (idx + 1) < parts.length) {
              broadcast = parts[idx + 1];
            }

            return {
              address: ip,
              prefix: prefix,
              broadcast: broadcast,
              label: parts[parts.length - 1]
            };
          });

        return {
          device: device,
          state: state,
          mac: mac,
          mtu: mtu,
          etherBroadcast: etherBroadcast,
          ipv4: ipv4
        };
      });
  }
}

module.exports = Ethernets;
