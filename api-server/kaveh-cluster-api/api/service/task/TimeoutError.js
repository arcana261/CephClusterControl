"use strict";

class TimeoutError extends Error {
  constructor(message) {
    super(message);
  }
}

module.exports = TimeoutError;
