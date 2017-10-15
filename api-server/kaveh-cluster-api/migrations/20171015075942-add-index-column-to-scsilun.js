"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('ScsiLuns', 'index', Sequelize.INTEGER, {transaction: t});
    await queryInterface.addIndex('ScsiLuns', {
      fields: ['scsiTargetId', 'index'],
      unique: true,
      transaction: t
    }, {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await queryInterface.removeIndex('ScsiLuns', ['scsiTargetId', 'index'], {transaction: t, unique: true});
    await queryInterface.removeColumn('ScsiLuns', 'index', {transaction: t});
  }
});
