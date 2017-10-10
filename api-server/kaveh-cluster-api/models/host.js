"use strict";

const HostStatus = require('../api/const/HostStatus');

/**
 * @typedef {object} HostModel
 * @property {string} hostName
 * @property {string} version
 * @property {string} ipList
 * @property {boolean} distro_centos
 * @property {boolean} distro_ubuntu
 * @property {string} distro_version
 * @property {string} status
 */

module.exports = (sequelize, DataTypes) => {
  const Host = sequelize.define('Host', {
    hostName: DataTypes.STRING,
    version: DataTypes.STRING,
    ipList: DataTypes.STRING,
    distro_centos: DataTypes.BOOLEAN,
    distro_ubuntu: DataTypes.BOOLEAN,
    distro_version: DataTypes.STRING,
    status: {
      type: DataTypes.STRING,
      validate: {
        isIn: [HostStatus._]
      }
    }
  }, {
    classMethods: {
    }
  });

  Host.associate =  function({Cluster, RpcType}) {
    Host.Cluster = Host.belongsTo(Cluster);
    Host.belongsToMany(RpcType, {through: 'HostRpcType'});
  };

  return Host;
};
