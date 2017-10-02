"use strict";

const crypto = require('crypto');
const CheckSum = require('../../utils/CheckSum');
const fs = require('mz/fs');
const path = require('path');
const Shell = require('../../utils/Shell');
const MkDir = require('../../utils/MkDir');
const Retry = require('../../utils/Retry');

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
 * @returns {Promise.<void>}
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
   * @param {string} dir
   * @returns {Promise.<Array.<string>>}
   * @private
   */
  _readdir(host, dir) {
    return this._client.call('multipart', host, 'multipart.readdir', [dir]);
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
   * @param {number} start
   * @param {number} count
   * @returns {Promise.<Array.<string|null>>}
   * @private
   */
  _queryPartHash(host, filePath, start, count) {
    try {
      return this._client.call('multipart', host, 'multipart.queryPartHash', [filePath, start, count]);
    }
    catch (err) {
      let result = [];

      for (let i = 0; i < count; i++) {
        result.push(null);
      }

      return result;
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
    let oldHash = [];

    const QUERY_HASH = 30;

    while (!quit) {
      if ((i % QUERY_HASH) === 0) {
        oldHash = await this._queryPartHash(filePath, i, QUERY_HASH);
      }

      const nextBuffer = await generator(i);

      if (nextBuffer !== null) {
        hash.update(nextBuffer);
        const sha = CheckSum.fromBuffer(nextBuffer);
        const part = nextBuffer.toString('base64');

        if (oldHash[i % QUERY_HASH] === sha) {
          continue;
        }

        await Retry.run(async () => {
          await this._uploadPart(host, filePath, i, part, sha);
        }, 1000, 10, err => speedReport(0, total / (1024 * 1024)));
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
    const buffer = new Buffer(20480);
    let last = -1;
    let done = false;

    try {
      await this._transfer(host, destination, async bucket => {
        if (done) {
          return null;
        }
        else {
          const [bytesRead] = await fs.read(handle, buffer, 0, 20480, (last + 1) === bucket ? null : bucket * 20480);
          last = bucket;

          if (bytesRead !== 20480) {
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
        await this.send(path.join(source, sub), host, path.join(destination, base), fileReporter, speedReporter);
      }
    }
    else {
      if (fileReporter !== null) {
        await fileReporter(source);
      }

      await this._sendFile(source, host, destination, speedReporter);
    }
  }

  /**
   * @param {string} host
   * @param {string} filePath
   * @returns {Promise.<string>}
   * @private
   */
  _checksum(host, filePath) {
    return this._client.call('multipart', host, 'multipart.checksum', [filePath], {timeout: -1});
  }

  /**
   * @param {string} host
   * @param {string} filePath
   * @param {number} start
   * @param {number} length
   * @returns {Promise.<{part: String, sha: string}>}
   * @private
   */
  _downloadPart(host, filePath, start, length) {
    return this._client.call('multipart', host, 'multipart.downloadPart', [filePath, start, length]);
  }

  /**
   * @param {string} host
   * @param {string} dir
   * @returns {Promise.<number>}
   */
  dirSize(host, dir) {
    return this._client.call('multipart', host, 'multipart.dirSize', [dir], {timeout: -1});
  }

  /**
   * @param {string} host
   * @param {string} source
   * @param {string} destination
   * @param {FileTransferSpeedReport|null} speedReport
   * @returns {Promise.<void>}
   * @private
   */
  async _receiveFile(host, source, destination, speedReport) {
    const hash = crypto.createHash('sha1');
    let done = false;
    let offset = 0;

    if ((await fs.lstat(destination)).isDirectory()) {
      destination = path.join(destination, path.basename(source));
    }

    const tmpFile = path.join(path.dirname(destination), `.${path.basename(destination)}.part`);
    let tick = (new Date()).getTime();
    let transferred = 0;
    let total = 0;

    const handle = await fs.open(tmpFile, 'w');

    try {
      while (!done) {
        const {part, sha} = await this._downloadPart(host, source, offset, 1024);
        const buffer = Buffer.from(part, 'base64');
        const actualSha = CheckSum.fromBuffer(buffer);

        if (actualSha !== sha) {
          throw new Error(`actual SHA1 "${actualSha}" does not match provided hash "${sha}"` +
            ` for byte range [${offset}, ${offset + 1024})`);
        }

        await fs.write(handle, buffer);
        hash.update(buffer);

        done = buffer.length < 1024;
        offset += buffer.length;

        if (speedReport !== null) {
          transferred += buffer.length;
          total += buffer.length;

          const now = (new Date()).getTime();

          if ((now - tick) >= 800) {
            speedReport((transferred / (800 / 1000)) / (1024 * 1024), total / (1024 * 1024));
            transferred = 0;
            tick = now;
          }
        }
      }
    }
    catch (err) {
      try {
        await fs.close(handle);
        await fs.unlink(tmpFile);
      }
      catch (err2) {
      }

      throw err;
    }

    try {
      await fs.close(handle);
      const sha = await this._checksum(host, source);
      const actualSha = hash.digest('base64');

      if (actualSha !== sha) {
        throw new Error(`actual SHA1 "${actualSha}" does not match provided hash "${sha}" for downloaded file`);
      }

      await Shell.exec('mv', '-f', `"${tmpFile}"`, `"${destination}"`);
    }
    catch (err) {
      try {
        await fs.unlink(tmpFile);
      }
      catch (err2) {
      }

      throw err;
    }
  }

  /**
   * @param {string} host
   * @param {string} source
   * @param {string} destination
   * @param {FileTransferOperationBeginReport|null} fileReporter
   * @param {FileTransferSpeedReport|null} speedReporter
   * @returns {Promise.<void>}
   */
  async receive(host, source, destination, fileReporter, speedReporter) {
    if (!(await this._exists(host, source))) {
      throw new Error(`source file does not exist to download: "${source}"`);

    }

    if ((await this._isDirectory(host, source))) {
      if (!(await fs.exists(destination))) {
        throw new Error(`destination "${destination}" does not exist for recursive folder download`);
      }

      if (!(await fs.lstat(destination)).isDirectory()) {
        throw new Error(`destination "${destination}" should be a folder for recursive folder download`);
      }

      const base = path.basename(source);
      await MkDir.path(path.join(destination, base));

      for (const sub of (await this._readdir(host, source))) {
        await this.receive(host, path.join(source, sub), path.join(destination, base), fileReporter, speedReporter);
      }
    }
    else {
      if (fileReporter !== null) {
        await fileReporter(source);
      }

      await this._receiveFile(host, source, destination, speedReporter);
    }
  }
}

module.exports = MultipartProxy;
