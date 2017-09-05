"use strict";

class UnfoldBroadcast {
  /**
   * @returns {Array.<{success: Boolean, hostname: String, instanceId: String, data: *}>}
   */
  static unfold(result) {
    return Object.entries(result)
      .map(x => Object.entries(x[1]))
      .reduce((prev, cur) => prev.concat(cur.map(x => x[1])), [])
  }
}

module.exports = UnfoldBroadcast;
