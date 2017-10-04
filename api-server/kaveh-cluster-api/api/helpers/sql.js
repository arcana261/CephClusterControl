'use strict';

const env = process.env.NODE_ENV || 'development';
/*
const config = require('../../config/config.json')[env];
const dialect = config.dialect;
*/
const types = require('./types');
const Task = require('co-task');

class SqlUtils {
  /**
   * @param {*} queryInterface
   * @param {string} slaveTable
   * @param {string} slaveKey
   * @param {string} masterTable
   * @param {string} masterKey
   * @param {*} options
   * @returns {Promise.<boolean>}
   */
  static async foreignKeyUp(queryInterface, slaveTable, slaveKey, masterTable, masterKey, options) {
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(
        `ALTER TABLE "${slaveTable}" ADD CONSTRAINT "${slaveKey.toLowerCase() + '_fkey'}"
          FOREIGN KEY("${slaveKey}") REFERENCES "${masterTable}"("${masterKey}") 
          MATCH SIMPLE ON UPDATE CASCADE ON DELETE CASCADE;`, options);
      return true;
    }

    throw new Error(`unsupported dialect: ${dialect}`);
  }

  /**
   * @param {*} queryInterface
   * @param {string} slaveTable
   * @param {string} slaveKey
   * @param {string} masterTable
   * @param {string} masterKey
   * @param {*} options
   * @returns {Promise.<boolean>}
   */
  static async foreignKeyDown(queryInterface, slaveTable, slaveKey, masterTable, masterKey, options) {
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(
        `ALTER TABLE "${slaveTable}" DROP CONSTRAINT "${slaveKey.toLowerCase() + '_fkey'}";`, options);
      return true;
    }

    throw new Error(`unsupported dialect: ${dialect}`);
  }

  /**
   * @param {T} obj
   * @returns {T}
   * @template T
   */
  static modernize(obj) {
    if (types.isFunction(obj) || types.isGeneratorFunction(obj)) {
      let argCount = obj.length;
      if (types.isGeneratorFunction(obj)) {
        obj = Task.async(obj);
      }

      if (argCount === 2) {
        return async (queryInterface, Sequelize) => {
          await obj(queryInterface, Sequelize);
        };
      }
      /*
      else {
        result[prop] = function (queryInterface, Sequelize) {
          return queryInterface.sequelize.transaction(transaction => {
            return value(transaction, queryInterface, Sequelize);
          });
        };
      }
      */
    }
    else if (types.isHashObject(obj)) {
      return Object.entries(obj)
        .map(([key, value]) => ({
          [key]: SqlUtils.modernize(value)
        })).reduce((prev, cur) => Object.assign(prev, cur), {});
    }
    else {
      return obj;
    }
  }
}