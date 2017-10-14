"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('SambaShares', 'hostId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'SambaShares', 'hostId', 'Hosts', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'SambaShares', 'hostId', 'Hosts', 'id', {transaction: t});
    await queryInterface.removeColumn('SambaShares', 'hostId', {transaction: t});
  }
});
