"use strict";

class OperationCanceledError extends Error {
  constructor(message) {
    super(message);
  }
}

module.exports = OperationCanceledError;
