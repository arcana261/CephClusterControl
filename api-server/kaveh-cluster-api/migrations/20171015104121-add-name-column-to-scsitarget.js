"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('ScsiTargets', 'name', Sequelize.STRING, {transaction: t});
    await queryInterface.addIndex('ScsiTargets', {
      fields: ['clusterId', 'name'],
      unique: true,
      transaction: t
    }, {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await queryInterface.removeIndex('ScsiTargets', ['clusterId', 'name'], {transaction: t});
    await queryInterface.removeColumn('ScsiTargets', 'name', {transaction: t});
  }
});
