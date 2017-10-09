"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.createTable('UserRole', {
      userId: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      roleId: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    }, {transaction: t});

    await sql.foreignKeyUp(queryInterface, 'UserRole', 'userId', 'Users', 'id', {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'UserRole', 'roleId', 'Roles', 'id', {transaction: t});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('UserRole');
  }
});
