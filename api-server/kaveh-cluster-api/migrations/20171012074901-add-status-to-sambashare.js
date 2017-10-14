"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('SambaShares', 'status', Sequelize.STRING);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('SambaShares', 'status');
  }
});
