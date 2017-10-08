"use strict";

module.exports = (sequelize, DataTypes) => {
  const Cluster = sequelize.define('Cluster', {
    name: DataTypes.STRING,
    brokerHost: DataTypes.STRING,
    brokerUserName: DataTypes.STRING,
    brokerPassword: DataTypes.STRING,
    brokerHeartBeat: DataTypes.INTEGER,
    brokerTopic: DataTypes.STRING,
    brokerTimeout: DataTypes.INTEGER
  }, {
    classMethods: {
      associate: function(models) {
        // associations can be defined here
      }
    }
  });

  return Cluster;
};