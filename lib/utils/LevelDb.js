"use strict";

const level = require('level');

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
}

module.exports = LevelDb;
