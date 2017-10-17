"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addIndex('RadosGatewayShares', {
      fields: ['clusterId', 'userName'],
      unique: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('RadosGatewayShares', ['clusterId', 'userName']);
  }
});
