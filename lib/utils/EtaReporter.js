"use strict";

class EtaReporter {
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
   * @param {number} t
   * @returns {string}
   */
  static format(t) {
    const ms = t % 1000;
    t = Math.floor(t / 1000);

    const s = t % 60;
    t = Math.floor(t / 60);

    const m = t % 60;
    t = Math.floor(t / 60);

    const h = t % 24;
    t = Math.floor(t / 24);

    const d = t % 30;
    t = Math.floor(t / 30);

    const M = t % 12;
    t = Math.floor(t / 12);

    const y = t;

    if (y < 1) {
      if (M < 1) {
        if (d < 1) {
          if (h < 1) {
            if (m < 1) {
              return EtaReporter._printItem(s, 'second');
            }
            else if (m < 6) {
              return `${EtaReporter._printItem(m, 'minute')}, ${EtaReporter._printItem(s, 'second')}`
            }
            else {
              return EtaReporter._printItem(m, 'minute');
            }
          }
          else {
            return EtaReporter._printItem(h, 'hour');
          }
        }
        else {
          return EtaReporter._printItem(d, 'day');
        }
      }
      else {
        return EtaReporter._printItem(M, 'month');
      }
    }
    else {
      return EtaReporter._printItem(y, 'year');
    }
  }
}

module.exports = EtaReporter;
