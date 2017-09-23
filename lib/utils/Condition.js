"use strict";

const log = require('logging').default('Condition');
const ErrorFormatter = require('./ErrorFormatter');

class Condition {
  constructor() {
    this._done = false;
    this._fired = false;
    this._success = false;
    this._result = null;
    this._wait = [];
  }

  /**
   * @private
   */
  _trigger() {
    if (this._done && !this._fired) {
      this._fired = true;

      if (this._success) {
        for (const [resolve,] of this._wait) {
          try {
            resolve(this._result);
          }
          catch (err) {
            log.error(`Uncought exception while calling success callbacks: ${ErrorFormatter.format(err)}`);
          }
        }
      }
      else {
        for (const [,reject] of this._wait) {
          try {
            reject(this._result);
          }
          catch (err) {
            log.error(`Uncought exception while calling failure callbacks: ${ErrorFormatter.format(err)}`);
          }
        }
      }

      this._wait = [];
    }
  }

  /**
   * @param {boolean} success
   * @param {*} result
   * @private
   */
  _set(success, result) {
    if (this._done) {
      throw new Error('condition variable can not be set more than once');
    }

    this._done = true;
    this._success = success;
    this._result = result;

    this._trigger();
  }

  /**
   * @param {*} result
   */
  resolve(result) {
    this._set(true, result);
  }

  /**
   * @param {*} err
   */
  reject(err) {
    this._set(false, err);
  }

  /**
   * @returns {Promise.<*>}
   */
  wait() {
    return new Promise((resolve, reject) => {
      if (this._fired) {
        if (this._success) {
          resolve(this._result);
        }
        else {
          reject(this._result);
        }
      }
      else {
        this._wait.push([resolve, reject]);
      }
    });
  }
}

module.exports = Condition;

