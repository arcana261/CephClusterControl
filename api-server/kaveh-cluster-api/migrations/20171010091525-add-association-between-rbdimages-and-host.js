"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.removeColumn('RbdImages', 'mountPoint_host', {transaction: t});
    await queryInterface.addColumn('RbdImages', 'hostId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'RbdImages', 'hostId', 'Hosts', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'RbdImages', 'hostId', 'Hosts', 'id', {transaction: t});
    await queryInterface.removeColumn('RbdImages', 'hostId', {transaction: t});
    await queryInterface.addColumn('RbdImages', 'mountPoint_host', Sequelize.STRING, {transaction: t});
  }
});
