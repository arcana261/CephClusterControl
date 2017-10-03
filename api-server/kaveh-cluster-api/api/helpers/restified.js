"use strict";

/*
const models = require('../../models');
const sequelize = models.sequelize;
const Sequelize = sequelize.Sequelize;
*/
const types = require('./types');
const Task = require('co-task');
const env = process.env.NODE_ENV || 'development';
const isStackTraceAvailable = env !== 'production';
const except = require('./except');

class Restified {
  /**
   * @param {T} value
   * @returns {T}
   * @template T
   * @private
   */
  static _restifyValue(value) {
    if (types.isFunction(value) || types.isGeneratorFunction(value)) {
      let argCount = value.length;

      if (types.isGeneratorFunction(value)) {
        value = Task.async(value);
      }

      const errorHandler = function (req, res, err) {
        let statusCode = 500;
        let message = 'internal server error occured';
        let stack = '';

        if (err instanceof Error) {
          message = err.message;

          if (isStackTraceAvailable) {
            stack = err.stack;
          }
          else {
            stack = 'stack trace disabled in production mode';
          }

          if (err instanceof except.CustomError) {
            statusCode = err.statusCode;
          }
          /*
          else if (err instanceof Sequelize.UniqueConstraintError) {
            statusCode = 409;
            message = JSON.stringify(err.errors);
          }
          */
        }

        res.statusCode = statusCode;
        res.json({
          code: -1,
          message: message,
          stack: stack
        });
      };

      if (argCount === 2) {
        return function (req, res) {
          (async () => {
            try {
              await value(req, res);
            }
            catch (err) {
              errorHandler(req, res, err);
            }
          })();
        };
      }
      /*
      else {
        return function (req, res) {
          let t = null;

          sequelize.transaction()
            .then(function (transaction) {
              t = transaction;
              return value(t, req, res);
            }).then(function () {
            return t.commit();
          }).catch(function (err) {
            t.rollback().finally(function () {
              errorHandler(req, res, err);
            });
          });
        }
      }
      */
    }
    else if (types.isHashObject(value)) {
      return Restified.make(value);
    }
    else {
      return value;
    }
  }

  /**
   * @param {T} obj
   * @returns {T}
   * @template T
   */
  static make(obj) {
    if (types.isHashObject(obj)) {
      return Object.entries()
        .map(([key, value]) => ({
          [key]: Restified._restifyValue(value)
        })).reduce((prev, cur) => Object.assign(prev, cur), {});
    }
    else {
      return Restified._restifyValue(obj);
    }
  }
}

/*
module.exports.autocommit = function (fn) {
  return function () {
    const args = Array.from(arguments);
    let t = null;

    return sequelize.transaction()
      .then(function (transaction) {
        t = transaction;
        return fn.apply(this, [t].concat(args));
      }).then(() => t.commit()).catch(err => {
        return t.rollback().finally(() => {
          throw err;
        });
      });
  };
};
*/

module.exports = Restified;
