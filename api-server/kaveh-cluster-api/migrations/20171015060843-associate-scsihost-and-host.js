"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('ScsiHosts', 'hostId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'ScsiHosts', 'hostId', 'Hosts', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'ScsiHosts', 'hostId', 'Hosts', 'id', {transaction: t});
    await queryInterface.removeColumn('ScsiHosts', 'hostId', {transaction: t});
  }
});
