"use strict";

class NumberPadder {
  /**
   * @returns {String}
   * @private
   */
  static _createFill(width, fill) {
    if (width < 1) {
      return '';
    }

    if (width === 1) {
      return fill;
    }

    const n2 = Math.floor(width / 2);
    let sub = NumberPadder._createFill(n2, fill);
    sub = sub + sub;

    if ((n2 * 2) < width) {
      sub = sub + fill;
    }

    return sub;
  }

  /**
   * @returns {String}
   */
  static pad(n, width = -1, fill = '0', {place = 'left'} = {}) {
    n = '' + n;

    if (n.length >= width) {
      return n;
    }

    const extra = NumberPadder._createFill(width - n.length, fill);

    if (place === 'left') {
      return extra + n;
    }
    else {
      return n + extra;
    }
  }
}

module.exports = NumberPadder;
