"use strict";

const shell = require('shelljs');
const { spawn } = require('child_process');
const uuid = require('uuid/v4');
const fs = require('mz/fs');
const MkDir = require('../utils/MkDir');

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

  /**
   * @param {string} stdin
   * @param {string} cmd
   * @param args
   * @returns {Promise.<string>}
   */
  static async execStdIn(stdin, cmd, ...args) {
    const tmpFile = `/tmp/kaveh-smb-stdio/${uuid()}`;

    await MkDir.path('/tmp/kaveh-smb-stdio');
    await fs.writeFile(tmpFile, stdin);

    try {
      return await (new Promise((resolve, reject) => {
        let finished = false;
        const stream = fs.createReadStream(tmpFile);

        stream.on('error', err => {
          if (!finished) {
            finished = true;
            reject(err);
          }
        });

        stream.on('open', () => {
          if (!finished) {
            let response = '';

            const child = spawn(cmd, args, {
              shell: true,
              stdio: [stream, 'pipe', 'pipe']
            });

            child.stdout.on('data', data => {
              response = response + data;
            });
            child.stderr.on('data', data => {
              response = response + data;
            });

            child.on('exit', code => {
              if (!finished) {
                finished = true;
                stream.close();

                if (!code) {
                  reject(response);
                }
                else {
                  resolve(response);
                }
              }
            });

            child.on('error', err => {
              if (!finished) {
                finished = true;
                stream.close();
                reject(err);
              }
            });
          }
        });

      }));
    }
    finally {
      try {
        await fs.unlink(tmpFile);
      }
      catch (err) {
      }
    }
  }
}

module.exports = Shell;
