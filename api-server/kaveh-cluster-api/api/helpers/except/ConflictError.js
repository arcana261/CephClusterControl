"use strict";

const CustomError = require('./CustomError');

class ConflictError extends CustomError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, 409);
  }
}

module.exports = ConflictError;
