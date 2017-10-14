"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('SambaShares', 'clusterId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'SambaShares', 'clusterId', 'Clusters', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'SambaShares', 'clusterId', 'Clusters', 'id', {transaction: t});
    await queryInterface.removeColumn('SambaShares', 'clusterId', {transaction: t});
  }
});
