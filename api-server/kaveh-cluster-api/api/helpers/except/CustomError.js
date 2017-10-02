"use strict";

class CustomError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   */
  constructor(message, statusCode) {
    super(message);

    this._statusCode = statusCode;
  }

  /**
   * @returns {number}
   */
  get statusCode() {
    return this._statusCode;
  }
}

module.exports = CustomError;
