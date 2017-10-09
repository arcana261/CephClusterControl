"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('Hosts', 'clusterId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'Hosts', 'clusterId', 'Clusters', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'Hosts', 'clusterId', 'Clusters', 'id', {transaction: t});
    await queryInterface.removeColumn('Hosts', 'clusterId', {transaction: t});
  }
});
