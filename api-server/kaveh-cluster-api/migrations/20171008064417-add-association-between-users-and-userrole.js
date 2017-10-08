'use strict';

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.addColumn('UserRoles', 'userId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'UserRoles', 'userId', 'Users', 'id', {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await sql.foreignKeyDown(queryInterface, 'UserRoles', 'userId', 'Users', 'id', {transaction: t});
    await queryInterface.removeColumn('UserRoles', 'userId', {transaction: t});
  }
});
