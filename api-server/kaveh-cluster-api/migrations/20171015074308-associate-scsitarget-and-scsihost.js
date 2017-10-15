"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('ScsiTargets', 'scsiHostId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'ScsiTargets', 'scsiHostId', 'ScsiHosts', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'ScsiTargets', 'scsiHostId', 'ScsiHosts', 'id', {transaction: t});
    await queryInterface.removeColumn('ScsiTargets', 'scsiHostId', {transaction: t});
  }
});
