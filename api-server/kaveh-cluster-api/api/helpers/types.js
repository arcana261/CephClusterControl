"use strict";

class TypeUtils {
  /**
   * @param {*} value
   * @returns {boolean}
   */
  static isFunction(value) {
    if (!value) {
      return false;
    }

    const type = {}.toString().call(value);
    return type === '[object Function]' || type === '[object AsyncFunction]';
  }

  /**
   * @param {*} value
   * @returns {boolean}
   */
  static isString(value) {
    return typeof value === 'string';
  }

  /**
   * @param value
   * @returns {boolean}
   */
  static isArray(value) {
    return value instanceof Array;
  }

  /**
   * @param obj
   * @returns {boolean}
   */
  static isGeneratorFunction(obj) {
    if (obj === null || obj === undefined) {
      return false;
    }

    let constructor = obj.constructor;
    if (!constructor) return false;
    if ('GeneratorFunction' === constructor.name || 'GeneratorFunction' === constructor.displayName) return true;
    return 'function' === typeof constructor.prototype.next && 'function' === typeof constructor.prototype.throw;
  }

  /**
   * @param {*} obj
   * @returns {boolean}
   */
  static isPromise(obj) {
    if (obj === null || obj === undefined) {
      return false;
    }

    return 'function' === typeof obj.then;
  }
}

module.exports = TypeUtils;
