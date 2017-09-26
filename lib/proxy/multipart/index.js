"use strict";

const crypto = require('crypto');
const CheckSum = require('../../utils/CheckSum');
const fs = require('mz/fs');
const path = require('path');

/**
 * @callback _FileTransferGenerator
 * @param {number} partNumber
 * @returns {Promise.<Buffer|null>}
 */

/**
 * @callback FileTransferSpeedReport
 * @param {number} speed
 * @param {number} transferred
 */

/**
 * @callback FileTransferOperationBeginReport
 * @param {string} filePath
 */

class MultipartProxy {
  /**
   * @param {ClientLoop} client
   */
  constructor(client) {
    this._client = client;
  }

  /**
   * @returns {ClientLoop}
   */
  get client() {
    return this._client;
  }

  /**
   * @returns {Promise.<WorkerInfoResponse>}
   */
  hosts() {
    return this._client.listHostsForType('multipart');
  }

  /**
   * @param {string} host
   * @param {string} filePath
   * @returns {Promise.<boolean>}
   * @private
   */
  _isDirectory(host, filePath) {
    return this._client.call('multipart', host, 'multipart.isDirectory', [filePath]);
  }

  /**
   * @param {string} host
   * @param {string} filePath
   * @returns {Promise.<boolean>}
   * @private
   */
  _exists(host, filePath) {
    return this._client.call('multipart', host, 'multipart.exists', [filePath]);
  }

  /**
   * @param {string} host
   * @param {string} folder
   * @returns {Promise.<void>}
   * @private
   */
  async _mkdir(host, folder) {
    const result = await this._client.call('multipart', host, 'multipart.mkdir', [folder]);

    if (!result) {
      throw new Error('unknown error occurred during operation: false');
    }
  }

  /**
   * @param {string} host
   * @param {string} filePath
   * @param {number} number
   * @param {string} part
   * @param {string} sha
   * @returns {Promise.<void>}
   * @private
   */
  async _uploadPart(host, filePath, number, part, sha) {
    const result = await this._client.call('multipart', host, 'multipart.uploadPart',
      [filePath, number, part, sha]);

    if (!result) {
      throw new Error('unknown error occurred during operation: false');
    }
  }

  /**
   * @param {string} host
   * @param {string} filePath
   * @param {number} parts
   * @param {string} sha
   * @returns {Promise.<void>}
   * @private
   */
  async _finalizeUpload(host, filePath, parts, sha) {
    const result = await this._client.call('multipart', host, 'multipart.finalizeUpload',
      [filePath, parts, sha], {timeout: -1});

    if (!result) {
      throw new Error('unknown error occurred during operation: false');
    }
  }

  /**
   * @param {string} host
   * @param {string} filePath
   * @param {_FileTransferGenerator} generator
   * @param {FileTransferSpeedReport|null} speedReport
   * @returns {Promise.<void>}
   * @private
   */
  async _transfer(host, filePath, generator, speedReport) {
    const hash = crypto.createHash('sha1');

    let i = 0;
    let quit = false;

    let tick = (new Date()).getTime();
    let total = 0;
    let transferred = 0;

    while (!quit) {
      const nextBuffer = await generator(i);

      if (nextBuffer !== null) {
        hash.update(nextBuffer);
        const sha = CheckSum.fromBuffer(nextBuffer);
        const part = nextBuffer.toString('base64');

        await this._uploadPart(host, filePath, i, part, sha);
        i = i + 1;

        if (speedReport !== null) {
          total += nextBuffer.length;
          transferred += nextBuffer.length;

          let now = (new Date()).getTime();

          if ((now - tick) >= 800) {
            speedReport((transferred / (800 / 1000)) / (1024 * 1024), total / (1024 * 1024));
            transferred = 0;
            tick = now;
          }
        }
      }
      else {
        const sha = hash.digest('base64');

        await this._finalizeUpload(host, filePath, i, sha);

        quit = true;
      }
    }
  }

  /**
   * @param {string} source
   * @param {string} host
   * @param {string} destination
   * @param {FileTransferSpeedReport|null} speedReport
   * @returns {Promise.<void>}
   * @private
   */
  async _sendFile(source, host, destination, speedReport) {
    if (!(await fs.exists(source))) {
      throw new Error(`source file does not exist to send: "${source}"`);
    }

    if ((await fs.lstat(source)).isDirectory()) {
      throw new Error(`sending directories is not supported: "${source}"`)
    }

    if (await this._isDirectory(host, destination)) {
      destination = path.join(destination, path.basename(source));
    }

    const handle = await fs.open(source, 'r');
    const buffer = new Buffer(1024);
    let last = -1;
    let done = false;

    try {
      await this._transfer(host, destination, async bucket => {
        if (done) {
          return null;
        }
        else {
          const [bytesRead] = await fs.read(handle, buffer, 0, 1024, (last + 1) === bucket ? null : bucket * 1024);
          last = bucket;

          if (bytesRead !== 1024) {
            done = true;
            return buffer.slice(0, bytesRead);
          }
          else {
            return buffer;
          }
        }
      }, speedReport);

      await fs.close(handle);
    }
    catch (err) {
      try {
        await fs.close(handle);
      }
      catch (err2) {
      }

      throw err;
    }
  }

  /**
   * @param {string} source
   * @param {string} host
   * @param {string} destination
   * @param {FileTransferOperationBeginReport|null} fileReporter
   * @param {FileTransferSpeedReport|null} speedReporter
   * @returns {Promise.<void>}
   */
  async send(source, host, destination, fileReporter, speedReporter) {
    if (!(await fs.exists(source))) {
      throw new Error(`source file does not exist to send: "${source}"`);
    }

    if ((await fs.lstat(source)).isDirectory()) {
      if (!(await this._exists(host, destination))) {
        throw new Error(`destination "${destination}" does not exist on host ${host} for recursive folder upload`);
      }

      if (!(await this._isDirectory(host, destination))) {
        throw new Error(`destination "${destination}" should be a folder on host ${host} for recursive folder upload`);
      }

      const base = path.basename(source);
      await this._mkdir(host, path.join(destination, base));

      for (const sub of (await fs.readdir(source))) {
        await this.send(path.join(source, sub), host, path.join(destination, base, sub), fileReporter, speedReporter);
      }
    }
    else {
      if (fileReporter !== null) {
        fileReporter(source);
      }

      return await this._sendFile(source, host, destination, speedReporter);
    }
  }
}

module.exports = MultipartProxy;
