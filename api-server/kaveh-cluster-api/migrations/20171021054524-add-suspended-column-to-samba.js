"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('SambaShares', 'suspended', Sequelize.BOOLEAN);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('SambaShares', 'suspended');
  }
});
