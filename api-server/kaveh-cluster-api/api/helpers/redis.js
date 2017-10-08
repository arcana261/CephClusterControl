"use strict";

const env = process.env.NODE_ENV || 'development';
const redisConfig = require('../../config/config.json')[env];
const Redis = require('../../../../lib/utils/Redis');
const PackageJson = require('../../../../package.json');
const types = require('./types');

const instance = new Redis(redisConfig);

class RedisConnection {
  /**
   * @returns {RedisClient}
   */
  static get() {
    return instance;
  }

  /**
   * @param {string} key
   * @returns {string}
   * @private
   */
  static _fixRedisKey(key) {
    return key.trim().replace(/[\s\-.]/g, '_');
  }

  /**
   * @param {string|Array.<string>} key
   * @returns {string}
   */
  static createKey(key) {
    if (types.isArray(key)) {
      return RedisConnection.createKey(key.join(':'));
    }
    else {
      return RedisConnection._fixRedisKey(`${PackageJson.name}:${PackageJson.version}:${key}`);
    }
  }
}

module.exports = RedisConnection;

