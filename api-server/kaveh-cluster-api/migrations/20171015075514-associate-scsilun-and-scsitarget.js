"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('ScsiLuns', 'scsiTargetId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'ScsiLuns', 'scsiTargetId', 'ScsiTargets', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'ScsiLuns', 'scsiTargetId', 'ScsiTargets', 'id', {transaction: t});
    await queryInterface.removeColumn('ScsiLuns', 'scsiTargetId', {transaction: t});
  }
});
