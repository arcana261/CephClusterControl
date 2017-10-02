"use strict";

const CustomError = require('./CustomError');

class NotFoundError extends CustomError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, 404);
  }
}

module.exports = NotFoundError;
