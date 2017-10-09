"use strict";

const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    await queryInterface.createTable('HostRpcType', {
      hostId: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      rpcTypeId: {
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

    await sql.foreignKeyUp(queryInterface, 'HostRpcType', 'hostId', 'Hosts', 'id', {transaction: t});
    await sql.foreignKeyUp(queryInterface, 'HostRpcType', 'rpcTypeId', 'RpcTypes', 'id', {transaction: t});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('HostRpcType');
  }
});
