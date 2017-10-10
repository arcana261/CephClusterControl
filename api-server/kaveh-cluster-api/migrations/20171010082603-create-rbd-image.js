'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('RbdImages', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      pool: {
        type: Sequelize.STRING
      },
      image: {
        type: Sequelize.STRING
      },
      capacity: {
        type: Sequelize.INTEGER
      },
      used: {
        type: Sequelize.INTEGER
      },
      fileSystem: {
        type: Sequelize.STRING
      },
      isMounted: {
        type: Sequelize.BOOLEAN
      },
      mountPoint_location: {
        type: Sequelize.STRING
      },
      mountPoint_host: {
        type: Sequelize.STRING
      },
      mountPoint_rbdId: {
        type: Sequelize.INTEGER
      },
      mountPoint_device: {
        type: Sequelize.STRING
      },
      mountPoint_readOnly: {
        type: Sequelize.BOOLEAN
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
    return queryInterface.dropTable('RbdImages');
  }
};