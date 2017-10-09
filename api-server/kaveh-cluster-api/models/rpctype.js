"use strict";

module.exports = (sequelize, DataTypes) => {
  const RpcType = sequelize.define('RpcType', {
    name: DataTypes.STRING
  }, {
    classMethods: {
    }
  });

  RpcType.associate = function({Host}) {
    RpcType.belongsToMany(Host, {through: 'HostRpcType'});
  };

  return RpcType;
};