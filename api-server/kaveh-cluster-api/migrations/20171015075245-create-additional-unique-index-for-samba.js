"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addIndex('SambaShares', {
      fields: ['clusterId', 'rbdImageId'],
      unique: true,
      transaction: t
    }, {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await queryInterface.removeIndex('ScsiTargets', ['clusterId', 'rbdImageId'], {transaction: t});
  }
});