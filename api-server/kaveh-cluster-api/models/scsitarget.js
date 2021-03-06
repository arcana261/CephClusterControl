"use strict";

const ScsiTargetStatus = require('../api/const/ScsiTargetStatus');

/**
 * @typedef {object} ScsiTargetModel
 * @property {string} iqn
 * @property {boolean} requiresAuth
 * @property {string} userName
 * @property {string} password
 * @property {string} status
 * @property {string} name
 * @property {boolean} suspended
 */

module.exports = (sequelize, DataTypes) => {
  const ScsiTarget = sequelize.define('ScsiTarget', {
    iqn: DataTypes.STRING,
    requiresAuth: DataTypes.BOOLEAN,
    userName: DataTypes.STRING,
    password: DataTypes.STRING,
    status: {
      type: DataTypes.STRING,
      validate: {
        isIn: [ScsiTargetStatus._]
      }
    },
    name: DataTypes.STRING,
    suspended: DataTypes.BOOLEAN,
    domain: DataTypes.STRING
  }, {
    classMethods: {
    }
  });

  ScsiTarget.associate = function({RbdImage, Cluster, ScsiHost, ScsiLun}) {
    ScsiTarget.RbdImage = ScsiTarget.belongsTo(RbdImage);
    ScsiTarget.Cluster = ScsiTarget.belongsTo(Cluster);
    ScsiTarget.ScsiHost = ScsiTarget.belongsTo(ScsiHost);
    ScsiTarget.hasMany(ScsiLun);
  };

  return ScsiTarget;
};