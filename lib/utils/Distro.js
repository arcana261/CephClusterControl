"use strict";

const getos = require('getos');

let _os = null;

/**
 * @typedef {object} DistroObject
 * @property {boolean} centos
 * @property {boolean} ubuntu
 * @property {string} version
 */

class Distro {
  /**
   * @returns {Promise.<DistroObject>}
   */
  static getDistro() {
    return new Promise((resolve, reject) => {
      if (_os) {
        resolve(_os);
      }
      else {
        getos((e, os) => {
          if (e) {
            reject(e);
          }
          else {
            const dist = os.dist.toLowerCase();

            _os = {
              centos: dist.indexOf('centos') >= 0,
              ubuntu: dist.indexOf('ubuntu') >= 0,
              version: os.release
            };

            resolve(_os);
          }
        });
      }
    });
  }

  /**
   * @param {DistroObject} distro
   */
  static formatDistro(distro) {
    if (distro.centos) {
      return `CentOS ${distro.version}`;
    }
    else if (distro.ubuntu) {
      return `Ubuntu ${distro.version}`;
    }
    else {
      throw new Error(`unsupported distro: ${JSON.stringify(distro)}`);
    }
  }
}

module.exports = Distro;
