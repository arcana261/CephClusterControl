"use strict";

/**
 * @typedef {object} RpcType
 * @property {string} name
 */

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