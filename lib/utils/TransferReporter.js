"use strict";

const EtaReporter = require('./EtaReporter');
const SizeParser = require('./SizeParser');
const PathPrinter = require('./PathPrinter');

class TransferReporter {
  /**
   * @param {number} totalSize
   */
  constructor(totalSize) {
    this._totalSize = totalSize;
    this._fileSize = 0;
    this._filePath = '';
    this._lastSpeed = 0;
    this._totalTransferred = 0;
    this._goToStart = false;
  }

  /**
   * @param {string} filePath
   * @param {number} size
   */
  newFile(filePath, size) {
    this.finish();

    process.stdout.write('\n');
    this._filePath = filePath;
    this._fileSize = size;
    this._goToStart = false;

    this.report(0, 0);
  }

  /**
   * @param {number} speed
   * @param {number} transferred
   */
  report(speed, transferred) {
    if (this._goToStart) {
      process.stdout.write('\r');
    }

    let eta = '...';

    if (this._fileSize > 0 && (speed > 0 || this._lastSpeed > 0)) {
      eta = EtaReporter.format(
        ((this._totalSize - this._totalTransferred - transferred) / Math.max(speed, this._lastSpeed)) * 1000);
    }

    const immutablePart = `    ${SizeParser.stringify(transferred)}/${SizeParser.stringify(this._fileSize)}    ` +
      `${SizeParser.stringify(speed)}/s    ` +
      `ETA: ${eta}`;

    let toWrite = `[${PathPrinter.summerize(this._filePath, process.stdout.columns - immutablePart.length - 4)}]`;

    while ((toWrite.length + immutablePart.length) < process.stdout.columns) {
      toWrite = toWrite + ' ';
    }

    toWrite = toWrite + immutablePart;
    process.stdout.write(toWrite);
    this._goToStart = true;

    if (speed > 0) {
      this._lastSpeed = speed;
    }
  }

  /**
   *
   */
  finish() {
    if (this._filePath !== '') {
      this.report(this._lastSpeed, this._fileSize);

      this._totalTransferred += this._fileSize;
      this._filePath = '';
      this._fileSize = 0;
    }
  }
}

module.exports = TransferReporter;
