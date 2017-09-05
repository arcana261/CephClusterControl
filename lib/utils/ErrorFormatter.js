"use strict";

const exceptionFormatter = require('exception-formatter');

class ErrorFormatter {
  /**
   * @returns {String}
   */
  static format(err) {
    return (err instanceof Error) ? exceptionFormatter(err) : err;
  }
}

module.exports = ErrorFormatter;
