"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addIndex('RbdImages', {
      fields: ['isMounted']
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('RbdImages', ['isMounted']);
  }
});
