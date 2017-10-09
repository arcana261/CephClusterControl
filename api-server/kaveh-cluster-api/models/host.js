"use strict";

const HostStatus = require('../api/const/HostStatus');

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
