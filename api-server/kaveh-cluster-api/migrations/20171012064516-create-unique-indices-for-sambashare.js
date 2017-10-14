"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addIndex('SambaShares', {
      fields: ['clusterId', 'name'],
      unique: true,
      transaction: t
    });

    await queryInterface.addIndex('SambaShares', {
      fields: ['clusterId'],
      transaction: t
    });
  },

  down: async (t, queryInterface, Sequelize) => {
    await queryInterface.removeIndex('SambaShares', ['clusterId'], {transaction: t});
  }
});
