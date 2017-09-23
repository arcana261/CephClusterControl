"use strict";

const path = require('path');

module.exports = {
  development: {
    etc: path.join(__dirname, '../etc/kaveh-cluster-ctrl.conf')
  },

  test: {
    etc: path.join(__dirname, '../etc/kaveh-cluster-ctrl.conf')
  },

  production: {
    etc: '/etc/kaveh-cluster-ctrl.conf'
  }
};
