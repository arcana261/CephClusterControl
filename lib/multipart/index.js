"use strict";

const CheckSum = require('../utils/CheckSum');
const MkDir = require('../utils/MkDir');
const NumberPadder = require('../utils/NumberPadder');
const fs = require('mz/fs');
const path = require('path');
const Shell = require('../utils/Shell');

const TMP = process.env.NODE_ENV === 'development' ?
  path.join(__dirname, '../../data/tmp') : '/tmp';

class MultipartServer {

  /**
   *
   * @returns {Promise.<boolean>}
   */
  static async capable() {
    return true;
  }

  /**
   * @param {{db: LevelDb}} opts
   */
  constructor(opts) {
  }

  /**
   * @param {string} filePath
   * @returns {Promise.<boolean>}
   */
  async isDirectory(filePath) {
    if (!(await fs.exists(filePath))) {
      return false;
    }

    const stat = await fs.lstat(filePath);

    return stat.isDirectory();
  }

  /**
   * @param {string} filePath
   * @returns {Promise.<boolean>}
   */
  exists(filePath) {
    return fs.exists(filePath);
  }

  /**
   * @param {string} folder
   * @returns {Promise.<boolean>}
   */
  async mkdir(folder) {
    await MkDir.path(folder);
    return true;
  }

  /**
   * @param {string} filePath
   * @param {number} number
   * @param {string} part
   * @param {string} sha
   * @returns {Promise.<boolean>}
   */
  async uploadPart(filePath, number, part, sha) {
    const buffer = Buffer.from(part, 'base64');
    const actualSha = CheckSum.fromBuffer(buffer);

    if (actualSha !== sha) {
      throw new Error(`provided sha "${sha}" does not match actual sha "${actualSha}"`);
    }

    const tmpFolder = path.join(TMP, 'kaveh-multipart/parts', filePath);
    await MkDir.path(tmpFolder);

    const tmpPath = `${tmpFolder}/${NumberPadder.pad(number, 10)}`;
    await fs.writeFile(tmpPath, buffer);

    return true;
  }

  /**
   * @param {string} filePath
   * @param {number} parts
   * @param {string} sha
   * @returns {Promise.<boolean>}
   */
  async finalizeUpload(filePath, parts, sha) {
    const tmpFolder = path.join(TMP, 'kaveh-multipart/parts', filePath);
    const saveFolder = path.join(TMP, 'kaveh-multipart/fs', path.dirname(filePath));
    const saveFileName = path.join(saveFolder, path.basename(filePath));

    await MkDir.path(tmpFolder);
    let partFileNames =
      (await fs.readdir(tmpFolder))
        .map(x => parseInt(x))
        .sort((x, y) => x - y);

    if (parts < partFileNames.length) {
      throw new Error(`too many actual parts "${partFileNames.length}" vs. expected "${parts}"`);
    }

    for (let i = 0; i < partFileNames.length; i++) {
      if (i !== partFileNames[i]) {
        throw new Error(`missing part# ${i} for multipart file ${filePath}`);
      }
    }

    if (partFileNames.length !== parts) {
      throw new Error(`missing part# ${partFileNames.length} for multipart file ${filePath}`);
    }

    partFileNames = null;

    await MkDir.path(saveFolder);
    const handle = await fs.open(saveFileName, 'w');

    try {
      for (let i = 0; i < parts; i++) {
        const tmpPath = path.join(tmpFolder, NumberPadder.pad(i, 10));
        const partBuffer = await fs.readFile(tmpPath);
        await fs.write(handle, partBuffer);
      }

      await fs.close(handle);
    }
    catch (err) {
      try {
        await fs.close(handle);
        await fs.unlink(saveFileName);
      }
      catch (err2) {

      }

      throw err;
    }

    const actualHash = await CheckSum.fromFile(saveFileName);

    if (actualHash !== sha) {
      try {
        await fs.unlink(saveFileName);
      }
      catch (err) {

      }

      throw new Error(`provided hash "${sha}" does not match actual hash "${actualHash}"`);
    }

    for (let i = 0; i < parts; i++) {
      const tmpPath = path.join(tmpFolder, NumberPadder.pad(i, 10));
      await fs.unlink(tmpPath);
    }

    await MkDir.path(path.dirname(filePath));
    await Shell.exec('mv', '-f', saveFileName, filePath);

    return true;
  }
}

module.exports = MultipartServer;
