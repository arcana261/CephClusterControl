'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('Clusters', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.STRING
      },
      brokerHost: {
        type: Sequelize.STRING
      },
      brokerUserName: {
        type: Sequelize.STRING
      },
      brokerPassword: {
        type: Sequelize.STRING
      },
      brokerHeartBeat: {
        type: Sequelize.INTEGER
      },
      brokerTopic: {
        type: Sequelize.STRING
      },
      brokerTimeout: {
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
    });
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.dropTable('Clusters');
  }
};