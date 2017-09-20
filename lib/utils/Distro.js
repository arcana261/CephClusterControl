"use strict";

const getos = require('getos');

let _os = null;

class Distro {
  /**
   * @returns {Promise.<{
   * centos: boolean,
   * ubuntu: boolean
   * }>}
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
              ubuntu: dist.indexOf('ubuntu') >= 0
            };

            resolve(_os);
          }
        });
      }
    });
  }
}

module.exports = Distro;
