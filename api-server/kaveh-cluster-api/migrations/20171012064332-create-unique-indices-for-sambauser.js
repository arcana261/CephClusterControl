"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addIndex('SambaUsers', {
      fields: ['hostId', 'userName'],
      unique: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('SambaUsers', ['hostId', 'userName']);
  }
});
