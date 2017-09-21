"use strict";

/**
 * @callback RetryCallback
 * @returns {Promise.<*>}
 */

/**
 * @callback RetryErrorLoggerCallback
 * @param {*} err
 */

class Retry {
  /**
   * @param {RetryCallback} fn
   * @param {number} retryCount
   * @param {number} wait
   * @param {*|null} lastErr
   * @param {RetryErrorLoggerCallback|null} errorLogger
   * @param {*} resolve
   * @param {*} reject
   * @private
   */
  static _run(fn, retryCount, wait, lastErr, errorLogger, resolve, reject) {
    try {
      if (retryCount < 0) {
        if (lastErr !== null) {
          reject(lastErr);
        }
        else {
          throw new Error('retry count is negative');
        }
      }
      else {
        (async () => {
          return await fn();
        })()
          .then(result => resolve(result))
          .catch(err => {
            let timeoutHandle = null;

            try {
              if (errorLogger !== null) {
                errorLogger(err);
              }

              timeoutHandle = setTimeout(() => Retry._run(fn, retryCount - 1, wait, err, resolve, reject), wait);
            }
            catch (err2) {
              reject(err2);

              if (timeoutHandle !== null) {
                clearTimeout(timeoutHandle);
              }
            }
          });
      }
    }
    catch (err) {
      reject(err);
    }
  }

  /**
   * @param {RetryCallback} fn
   * @param {number} wait
   * @param {number} retryCount
   * @param {RetryErrorLoggerCallback|null} errorLogger
   * @returns {Promise.<*>}
   */
  static run(fn, wait = -1, retryCount = -1, errorLogger = null) {
    return new Promise(
      (resolve, reject) =>
        Retry._run(fn, retryCount < 0 ? 1000 : retryCount, wait < 0 ? 1 : wait, null, resolve, reject));
  }
}

module.exports = Retry;
