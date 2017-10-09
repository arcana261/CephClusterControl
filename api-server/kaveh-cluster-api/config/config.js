"use strict";

const path = require('path');

module.exports = {
  development: {
    etc: path.join(__dirname, '../etc/kaveh-cluster-api.conf')
  },
  test: {
    etc: path.join(__dirname, '../etc/kaveh-cluster-api.conf')
  },
  production: {
    etc: '/etc/kaveh-cluster-api.conf'
  }
};
