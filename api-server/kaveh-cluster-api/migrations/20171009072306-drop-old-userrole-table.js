"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('UserRoles');
  },

  down: async (t, queryInterface, Sequelize) => {
    await queryInterface.createTable('UserRoles', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      role: {
        type: Sequelize.STRING
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
    await queryInterface.addColumn('UserRoles', 'userId', Sequelize.INTEGER, {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'UserRoles', 'userId', 'Users', 'id', {transaction: t});
  }
});
