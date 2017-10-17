"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('RadosGatewayShares', 'clusterId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'RadosGatewayShares', 'clusterId', 'Clusters', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'RadosGatewayShares', 'clusterId', 'Clusters', 'id', {transaction: t});
    await queryInterface.removeColumn('RadosGatewayShares', 'clusterId', {transaction: t});
  }
});
