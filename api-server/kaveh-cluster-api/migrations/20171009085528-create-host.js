'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('Hosts', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      hostName: {
        type: Sequelize.STRING
      },
      version: {
        type: Sequelize.STRING
      },
      ipList: {
        type: Sequelize.STRING
      },
      distro_centos: {
        type: Sequelize.BOOLEAN
      },
      distro_ubuntu: {
        type: Sequelize.BOOLEAN
      },
      distro_version: {
        type: Sequelize.STRING
      },
      status: {
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
    });
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.dropTable('Hosts');
  }
};