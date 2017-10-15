"use strict";

const ScsiHostStatus = require('../api/const/ScsiHostStatus');

/**
 * @typedef {object} ScsiHostModel
 * @property {boolean} requiresAuth
 * @property {string} userName
 * @property {string} password
 */

module.exports = (sequelize, DataTypes) => {
  const ScsiHost = sequelize.define('ScsiHost', {
    requiresAuth: DataTypes.BOOLEAN,
    userName: DataTypes.STRING,
    password: DataTypes.STRING,
    status: {
      type: DataTypes.STRING,
      validate: {
        isIn: ScsiHostStatus._
      }
    }
  }, {
    classMethods: {
    }
  });

  ScsiHost.associate = function({Host, Cluster, ScsiTarget}) {
    ScsiHost.Host = ScsiHost.belongsTo(Host);
    ScsiHost.Cluster = ScsiHost.belongsTo(Cluster);
    ScsiHost.hasMany(ScsiTarget);
  };

  return ScsiHost;
};
