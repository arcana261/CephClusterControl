"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addIndex('ScsiHosts', {
      fields: ['hostId'],
      unique: true,
    }, {transaction: t});

    await queryInterface.addIndex('ScsiHosts', {
      fields: ['clusterId']
    }, {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await queryInterface.removeIndex('ScsiHosts', ['clusterId'], {transaction: t});
    await queryInterface.removeIndex('ScsiHosts', ['hostId'], {transaction: t});
  }
});
