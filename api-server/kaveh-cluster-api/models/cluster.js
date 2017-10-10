"use strict";

/**
 * @typedef {object} ClusterModel
 * @property {string} name
 * @property {string} brokerHost
 * @property {string} brokerUserName
 * @property {string} brokerPassword
 * @property {number} brokerHeartBeat
 * @property {string} brokerTopic
 * @property {number} brokerTimeout
 */

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
    }
  });

  Cluster.associate = function({Host}) {
    Cluster.hasMany(Host);
  };

  return Cluster;
};