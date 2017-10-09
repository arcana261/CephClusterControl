"use strict";

class CancelationPoint {
  /**
   * @param {Task} task
   */
  constructor(task) {
    this._task = task;
  }

  /**
   */
  checkExceptionPoint() {
    this._task._checkExceptionPoint();
  }
}

module.exports = CancelationPoint;
