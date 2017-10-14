"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('SambaUsers', 'hostId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'SambaUsers', 'hostId', 'Hosts', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'SambaUsers', 'hostId', 'Hosts', 'id', {transaction: t});
    await queryInterface.removeColumn('SambaUsers', 'hostId', {transaction: t});
  }
});
