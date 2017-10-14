"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addIndex('SambaAcls', {
      fields: ['sambaUserId', 'sambaShareId'],
      unique: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('SambaAcls', ['sambaUserId', 'sambaShareId']);
  }
});
