"use strict";

const fs = require('mz/fs');
const path = require('path');
const log = require('logging').default('DirectoryCleaner');
const ErrorFormatter = require('./ErrorFormatter');

class DirectoryCleaner {
  /**
   * @param {string} dir
   * @param {number} threshold
   * @returns {Promise.<void>}
   * @private
   */
  static async _clean(dir, threshold) {
    try {
      const stat = await fs.lstat(dir);

      if (stat.isDirectory()) {
        for (const sub of (await fs.readdir(dir))) {
          await DirectoryCleaner._clean(path.join(dir, sub), threshold);
        }

        if ((await fs.readdir(dir)).length < 1) {
          await fs.rmdir(dir);
        }
      }
      else if ((stat.birthtime.getTime()) < threshold) {
        await fs.unlink(dir);
      }
    }
    catch (err) {
      log.warn(`failed to cleanup file/directory "${dir}"`);
      log.warn(ErrorFormatter.format(err));
    }
  }

  /**
   * @param {string} dir
   * @param {number} ageInDays
   * @returns {Promise.<void>}
   */
  static clean(dir, ageInDays) {
    return DirectoryCleaner._clean(dir, (new Date()).getTime() - (ageInDays * 24 * 3600 * 1000));
  }
}

module.exports = DirectoryCleaner;

