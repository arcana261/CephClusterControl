"use strict";

class PathPrinter {
  /**
   * @param {string} path
   * @param {number} maxLength
   * @returns {string}
   */
  static summerize(path, maxLength = 10) {
    let leadingSlash = path.startsWith('/');
    let length = path.length;

    if (leadingSlash) {
      path = path.substr(1);
    }

    const parts = path.split('/');

    while (length > maxLength && parts.length > 3) {
      let at = Math.floor(parts.length / 2) - 1;

      length = length - parts[at].length - parts[at + 1].length - 1 + 3;
      parts.splice(at, 2, '...');
    }

    if (length > maxLength) {
      const partFileNameLengths = parts.map((x, i) => {
        const idx = x.lastIndexOf('.');
        if (idx < 0) {
          return {at: i, len: x.length};
        }
        else {
          return {at: i, len: idx};
        }
      }).filter(x => x.len > 8).sort((x, y) => y.len - x.len);

      for (let i = 0; i < partFileNameLengths.length && length > maxLength; i++) {
        const {at} = partFileNameLengths[i];
        const x = parts[at];
        const idx = x.lastIndexOf('.');
        let name = x;
        let ext = '';

        if (idx >= 0) {
          name = x.substr(0, idx);
          ext = x.substr(idx + 1);
        }

        const newName = name.substr(0, 7) + '~.' + ext;

        length = length - parts[at].length + newName.length;
        parts[at] = newName;
      }
    }

    return (leadingSlash ? '/' : '') + parts.join('/');
  }
}

module.exports = PathPrinter;
