"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addIndex('Clusters', {
      fields: ['name'],
      unique: true
    })
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('Clusters', ['name']);
  }
});