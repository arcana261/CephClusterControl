"use strict";

const CustomError = require('./CustomError');

class InternalServerError extends CustomError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, 500);
  }
}

module.exports = InternalServerError;
