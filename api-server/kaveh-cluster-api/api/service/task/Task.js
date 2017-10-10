"use strict";

const OperationCanceledError = require('./OperationCanceledError');
const TimeoutError = require('./TimeoutError');
const CancelationPoint = require('./CancelationPoint');

/**
 * @callback TaskCallback
 * @param {CancelationPoint} cancelationPoint
 * @returns {Promise.<*>}
 */

class Task {
  /**
   * @param {TaskCallback} callback
   */
  constructor(callback) {
    this._error = null;
    this._hasError = false;
    this._callback = callback;
    this._status = 'stopped';
    this._promise = new Promise((resolve, reject) => resolve());
    this._result = null;
    this._startTime = null;
    this._finishTime = null;
  }

  /**
   * @returns {boolean}
   */
  get isRunning() {
    return this._status === 'running';
  }

  /**
   * @returns {boolean}
   */
  get isCanceled() {
    return this._status === 'canceled';
  }

  /**
   * @returns {boolean}
   */
  get isFailed() {
    return this._status === 'error';
  }

  /**
   * @returns {boolean}
   */
  get isSuccessful() {
    return this._status === 'done';
  }

  /**
   * @returns {boolean}
   */
  get isCompleted() {
    return this.isCanceled || this.isFailed || this.isSuccessful;
  }

  /**
   * @returns {boolean}
   */
  get isStopped() {
    return !this.isRunning;
  }

  /**
   * @returns {null|Date}
   */
  get startTime() {
    return this._startTime;
  }

  /**
   * @returns {null|Date}
   */
  get finishTime() {
    return this._finishTime;
  }

  /**
   * @returns {Promise.<*>}
   */
  run() {
    if (this._status !== 'running') {
      this._status = 'running';
      this._startTime = new Date();
      this._finishTime = null;
      this._error = null;
      this._hasError = false;
      this._result = null;

      this._promise = new Promise((resolve, reject) => {
        const self = this;

        function errorHandler(err) {
          self._finishTime = new Date();

          if (err instanceof OperationCanceledError) {
            self._status = 'canceled';
          }
          else {
            self._status = 'error';
            self._result = err;
          }

          resolve();
        }

        try {
          this._callback(new CancelationPoint(this))
            .then(result => {
              this._finishTime = new Date();
              this._status = 'done';
              this._result = result;

              resolve();
            }).catch(err => {
              errorHandler(err);
            });
        }
        catch (err) {
          errorHandler(err);
        }
      });
    }

    return this.wait();
  }

  /**
   * @param {Error|OperationCanceledError} err
   */
  raiseError(err) {
    this._error = err;
    this._hasError = true;
  }

  /**
   * @returns {Promise<*>}
   * @private
   */
  _wait() {
    return this._promise.then(() => {
      if (this._status === 'stopped') {
        return Promise.resolve();
      }
      else if (this._status === 'canceled') {
        return Promise.reject(new OperationCanceledError('operation is canceled'));
      }
      else if (this._status === 'done') {
        return Promise.resolve(this._result);
      }
      else if (this._status === 'error') {
        return Promise.reject(this._result);
      }
      else {
        return Promise.reject(new Error(`unexpected status: "${this._status}"`));
      }
    });
  }

  /**
   * @param {number|null} ms
   * @returns {Promise.<*>}
   */
  wait(ms = -1) {
    if (!ms || ms < 1) {
      return this._wait();
    }

    return new Promise((resolve, reject) => {
      let finished = false;
      let timeoutHandle = null;

      try {
        timeoutHandle = setTimeout(() => {
          if (!finished) {
            finished = true;
            reject(new TimeoutError('operation timedout'));
          }
        }, ms);

        this._wait().then(result => {
          if (!finished) {
            finished = true;
            clearTimeout(timeoutHandle);
            resolve(result);
          }
        }).catch(err => {
          if (!finished) {
            finished = true;
            clearTimeout(timeoutHandle);
            reject(err);
          }
        });
      }
      catch (err) {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
        }

        reject(timeoutHandle);
      }
    });
  }

  /**
   * @returns {Promise<*>}
   */
  cancel() {
    this.raiseError(new OperationCanceledError('operation is canceled'));

    return this._promise.then(() => {
      if (this._status === 'canceled' || this._status === 'stopped') {
        return Promise.resolve();
      }
      else if (this._status === 'done') {
        return Promise.resolve(this._result);
      }
      else if (this._status === 'error') {
        return Promise.reject(this._result);
      }
      else {
        return Promise.reject(new Error(`unexpected status: "${this._status}"`));
      }
    });
  }

  /**
   * @returns {Promise.<*>}
   */
  restart() {
    this.cancel().then(() => this.run());
  }

  /**
   * @private
   */
  _checkExceptionPoint() {
    if (this._hasError) {
      throw this._error;
    }
  }
}

module.exports = Task;
