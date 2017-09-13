"use strict";

const log = require('logging').default('CephClient');
const CephPoolClient = require('./CephPoolClient');
const CephAuthClient = require('./CephAuthClient');
const ErrorFormatter = require('../utils/ErrorFormatter');

class CephClient {
  static async capable() {
    try {
      await (new CephPoolClient()).ls();
      return true;
    }
    catch (err) {
      log.error(ErrorFormatter.format(err));
      return false;
    }
  }

  /**
   * @param {{db: *}} opts
   */
  constructor(opts) {
    this._db = opts.db;
    this._pool = new CephPoolClient();
    this._auth = new CephAuthClient();
  }

  /**
   * @returns {CephPoolClient}
   */
  get pool() {
    return this._pool;
  }

  /**
   * @returns {CephAuthClient}
   */
  get auth() {
    return this._auth;
  }
}

module.exports = CephClient;
