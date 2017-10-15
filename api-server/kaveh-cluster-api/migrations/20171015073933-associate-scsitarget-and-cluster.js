"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('ScsiTargets', 'clusterId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'ScsiTargets', 'clusterId', 'Clusters', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'ScsiTargets', 'clusterId', 'Clusters', 'id', {transaction: t});
    await queryInterface.removeColumn('ScsiTargets', 'clusterId', {transaction: t});
  }
});
