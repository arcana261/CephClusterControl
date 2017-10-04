"use strict";

const NumberPadder = require('./NumberPadder');

/**
 * @callback TablePrinterCallback
 * @param {T}
 * @returns {String}
 * @template T
 */

class TablePrinter {
  /**
   * @param {Array.<T>} result
   * @param {Array.<{key: String, value: TablePrinterCallback.<T>}>} cols
   * @returns {string}
   * @template T
   */
  static format(result, cols) {
    let output = '';

    const rows =
      [cols.map(x => x.key)]
        .concat(result.map(row => cols.map(col => col.value(row))))
        .map(row => {
          const convertedRow = row.map(cell => (cell instanceof Array) ? cell : [cell]);
          const maxSize = convertedRow.reduce((prev, cell) => Math.max(prev, cell.length), 0);
          const result = [];

          for (let i = 0; i < maxSize; i++) {
            result.push(convertedRow.map(cell => (i < cell.length) ? cell[i] : ''));
          }

          return result;
        }).reduce((prev, cur) => prev.concat(cur), []);

    const size = cols.map((x, i) =>
      rows.reduce((prev, cur) => cur[i].length > prev ? cur[i].length : prev, 0));

    return rows.reduce((out, row) =>
      out + row.map((x, i) => NumberPadder.pad(x, size[i], ' ', {place: 'right'})).join(' ') + '\n', '');
  }

  /**
   * @param {Array.<*>} result
   * @param {Array.<{key: String, value: TablePrinterCallback.<T>}>} cols
   * @template T
   */
  static print(result, cols) {
    console.log(TablePrinter.format(result, cols));
  }
}

module.exports = TablePrinter;
