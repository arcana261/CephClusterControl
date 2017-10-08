"use strict";

const redis = require('redis');

class RedisClient {
  /**
   * @param {*} opts
   */
  constructor(opts) {
    this._client = redis.createClient(opts);
  }

  /**
   * @param {string} key
   * @param {string} value
   * @param {number|null} expire - expire in seconds
   * @returns {Promise}
   */
  set(key, value, {expire = null} = {}) {
    return new Promise((resolve, reject) => {
      try {
        const cb = err => {
          if (err) {
            reject(err);
          }
          else {
            resolve();
          }
        };

        if (expire !== null) {
          this._client.set(key, value, 'EX', expire, cb);
        }
        else {
          this._client.set(key, value, cb);
        }
      }
      catch (err) {
        reject(err);
      }
    });
  }

  /**
   * @param {string} key
   * @returns {Promise.<string>}
   */
  get(key) {
    return new Promise((resolve, reject) => {
      try {
        this._client.get(key, (err, value) => {
          if (err) {
            reject(err);
          }
          else {
            resolve(value);
          }
        });
      }
      catch (err) {
        reject(err);
      }
    });
  }
}

module.exports = RedisClient;
