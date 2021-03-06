"use strict";

class CustomExceptions {
  static get BadRequestError() {
    return require('./BadRequestError');
  }

  static get ConflictError() {
    return require('./ConflictError');
  }

  static get InternalServerError() {
    return require('./InternalServerError');
  }

  static get NotFoundError() {
    return require('./NotFoundError');
  }

  static get CustomError() {
    return require('./CustomError');
  }
}

module.exports = CustomExceptions;
