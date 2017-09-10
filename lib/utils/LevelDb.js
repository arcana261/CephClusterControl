"use strict";

const level = require('level');
const uuid = require('uuid/v4');

class LevelDb {
  constructor(filename) {
    this._db = level(filename);
  }

  /**
   * @returns {Promise}
   */
  open() {
    return new Promise((resolve, reject) => this._db.open(err => {
      if (err) {
        reject();
      }
      else {
        resolve();
      }
    }));
  }

  /**
   * @returns {Promise}
   */
  close() {
    return new Promise((resolve, reject) => this._db.close(err => {
      if (err) {
        reject();
      }
      else {
        resolve();
      }
    }));
  }

  /**
   * @returns {Promise.<String>}
   */
  get(key) {
    return new Promise((resolve, reject) => this._db.get(key, (err, value) => {
      if (err) {
        reject(err);
      }
      else {
        resolve(value);
      }
    }));
  }

  /**
   * @returns {Promise}
   */
  put(key, value) {
    return new Promise((resolve, reject) => this._db.put(key, value, err => {
      if (err) {
        reject(err);
      }
      else {
        resolve();
      }
    }));
  }

  /**
   * @returns {Promise}
   */
  del(key) {
    return new Promise((resolve, reject) => this._db.del(key, err => {
      if (err) {
        reject(err);
      }
      else {
        resolve();
      }
    }));
  }

  /**
   * @returns {Boolean}
   */
  isOpen() {
    return this._db.isOpen();
  }

  /**
   * @returns {Boolean}
   */
  isClosed() {
    return this._db.isClosed();
  }

  /**
   * @returns {Promise.<Array.<{key: String, value: String}>>}
   */
  read({gt = null, gte = null, lt = null, lte = null, count = -1}) {
    return new Promise((resolve, reject) => {
      let result = [];
      let done = false;

      let options = {};

      if (gt) {
        options.gt = gt;
      }

      if (gte) {
        options.gte = gte;
      }

      if (lt) {
        options.lt = lt;
      }

      if (lte) {
        options.lte = lte;
      }

      if (count > -1) {
        options.limit = count;
      }

      this._db.createReadStream(options)
        .on('data', data => {
        result.push({
          key: data.key,
          value: data.value
        });
      }).on('error', err => {
        if (!done) {
          done = true;
          reject(err);
        }
      }).on('close', () => {
        if (!done) {
          done = true;
          resolve(result);
        }
      }).on('end', () => {
        if (!done) {
          done = true;
          resolve(result);
        }
      });
    });
  }
}

module.exports = LevelDb;
