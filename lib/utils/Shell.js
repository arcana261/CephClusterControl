"use strict";

const shell = require('shelljs');

class Shell {
  /**
   * @returns {Promise.<String>}
   */
  static exec(cmd, ...args) {
    return new Promise((resolve, reject) => {
      shell.exec(`${cmd} ${args.join(' ')}`, {async: true, silent: true}, (code, stdout, stderr) => {
        if (!code) {
          resolve(stdout.toString());
        }
        else {
          reject((stderr && stderr.toString()) || stdout.toString());
        }
      });
    });
  }
}

module.exports = Shell;
