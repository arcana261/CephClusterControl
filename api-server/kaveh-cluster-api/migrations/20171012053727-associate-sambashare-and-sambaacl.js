"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('SambaAcls', 'sambaShareId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'SambaAcls', 'sambaShareId', 'SambaShares', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'SambaAcls', 'sambaShareId', 'SambaShares', 'id', {transaction: t});
    await queryInterface.removeColumn('SambaAcls', 'sambaShareId', {transaction: t});
  }
});
