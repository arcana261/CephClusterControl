"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('SambaAcls', 'sambaUserId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'SambaAcls', 'sambaUserId', 'SambaUsers', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'SambaAcls', 'sambaUserId', 'SambaUsers', 'id', {transaction: t});
    await queryInterface.removeColumn('SambaAcls', 'sambaUserId', {transaction: t});
  }
});
