"use strict";

class AgeReporter {
  /**
   * @returns {String}
   * @private
   */
  static _printItem(value, format) {
    if (value < 2) {
      return `a ${format}`;
    }
    else {
      return `${value} ${format}s`
    }
  }

  /**
   * @returns {String}
   */
  static format(ts1, ts2) {
    let diff = Math.abs(ts1 - ts2);

    const ms = diff % 1000;
    diff = Math.floor(diff / 1000);

    const s = diff % 60;
    diff = Math.floor(diff / 60);

    const m = diff % 60;
    diff = Math.floor(diff / 60);

    const h = diff % 24;
    diff = Math.floor(diff / 24);

    const d = diff;

    if (d < 1) {
      if (h < 1) {
        if (m < 1) {
          if (s < 30) {
            return 'now';
          }
          else {
            return AgeReporter._printItem(s, 'second');
          }
        }
        else {
          return AgeReporter._printItem(m, 'minute');
        }
      }
      else {
        return AgeReporter._printItem(h, 'hour');
      }
    }
    else {
      return AgeReporter._printItem(d, 'day');
    }
  }
}

module.exports = AgeReporter;
