"use strict";

const NumberPadder = require('./NumberPadder');

/**
 * @callback TablePrinterCallback
 * @param {*}
 * @returns {String}
 */

class TablePrinter {
  /**
   * @param {Array.<*>} result
   * @param {Array.<{key: String, value: TablePrinterCallback}>} cols
   */
  static print(result, cols) {
    const rows = [cols.map(x => x.key)].concat(result.map(row => cols.map(col => col.value(row))));
    const size = cols.map((x, i) =>
      rows.reduce((prev, cur) => cur[i].length > prev ? cur[i].length : prev, 0))

    rows.forEach(row =>
      console.log(row.map((x, i) => NumberPadder.pad(x, size[i], ' ', {place: 'right'})).join(' ')));
  }
}

module.exports = TablePrinter;
