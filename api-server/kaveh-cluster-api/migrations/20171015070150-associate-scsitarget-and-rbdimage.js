"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('ScsiTargets', 'rbdImageId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'ScsiTargets', 'rbdImageId', 'RbdImages', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'ScsiTargets', 'rbdImageId', 'RbdImages', 'id', {transaction: t});
    await queryInterface.removeColumn('ScsiTargets', 'rbdImageId', {transaction: t});
  }
});
