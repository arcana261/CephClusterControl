"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addIndex('RbdImages', {
      fields: ['clusterId', 'pool', 'image'],
      unique: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('RbdImages', ['clusterId', 'pool', 'image']);
  }
});
