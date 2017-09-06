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
   * @returns {Promise.<void>}
   */
  putMultiSet(key, value) {
    return this.put(`${key}:multiset:${uuid().replace(/-/g, '')}`, value);
  }

  /**
   * @returns {Promise.<Array.<{key: String, value: String}>>}
   * @private
   */
  _getMultiSet(key) {
    return new Promise((resolve, reject) => {
      const lowerBound = `${key}:multiset:00000000000000000000000000000000`;
      const upperBound = `${key}:multiset:ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ`;

      let result = [];
      let done = false;

      this._db.createReadStream({
        gte: lowerBound,
        lte: upperBound
      }).on('data', data => {
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

  /**
   * @returns {Promise.<Array.<String>>}
   */
  async getMultiSet(key) {
    return (await this._getMultiSet(key)).map(x => x.value);
  }

  /**
   * @returns {Promise.<void>}
   */
  async delMultiSetItem(key, value) {
    const result = (await this._getMultiSet(key)).filter(x => x.value === value).map(x => x.key);

    if (result.length > 0) {
      await this.del(result[0]);
    }
  }

  /**
   * @returns {Promise.<void>}
   */
  async delMultiSet(key) {
    for(const itemKey of (await this._getMultiSet(key)).map(x => x.key)) {
      await this.del(itemKey);
    }
  }
}

module.exports = LevelDb;
