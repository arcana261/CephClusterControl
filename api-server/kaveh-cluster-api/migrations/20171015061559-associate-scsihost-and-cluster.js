"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('ScsiHosts', 'clusterId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'ScsiHosts', 'clusterId', 'Clusters', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'ScsiHosts', 'clusterId', 'Clusters', 'id', {transaction: t});
    await queryInterface.removeColumn('ScsiHosts', 'clusterId', {transaction: t});
  }
});
