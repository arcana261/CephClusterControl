"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('SambaShares', 'rbdImageId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'SambaShares', 'rbdImageId', 'RbdImages', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'SambaShares', 'rbdImageId', 'RbdImages', 'id', {transaction: t});
    await queryInterface.removeColumn('SambaShares', 'rbdImageId', {transaction: t});
  }
});
