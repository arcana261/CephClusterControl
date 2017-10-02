"use strict";

const CustomError = require('./CustomError');

class BadRequestError extends CustomError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, 400);
  }
}

module.exports = BadRequestError;
