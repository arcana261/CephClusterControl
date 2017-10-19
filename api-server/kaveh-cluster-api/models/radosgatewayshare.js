"use strict";

const RadosGatewayShareStatus = require('../api/const/RadosGatewayShareStatus');

/**
 * @typedef {object} RadosGatewayShareModel
 * @property {string} userName
 * @property {string} fullName
 * @property {string} email
 * @property {string} accessKey
 * @property {string} secretKey
 * @property {boolean} hasQuota
 * @property {number} capacity
 * @property {number} used
 * @property {string} status
 * @property {boolean} suspended
 */

module.exports = (sequelize, DataTypes) => {
  const RadosGatewayShare = sequelize.define('RadosGatewayShare', {
    userName: DataTypes.STRING,
    fullName: DataTypes.STRING,
    email: DataTypes.STRING,
    accessKey: DataTypes.STRING,
    secretKey: DataTypes.STRING,
    hasQuota: DataTypes.BOOLEAN,
    capacity: DataTypes.INTEGER,
    used: DataTypes.INTEGER,
    status: {
      type: DataTypes.STRING,
      validate: {
        isIn: [RadosGatewayShareStatus._]
      }
    },
    suspended: DataTypes.BOOLEAN
  }, {
    classMethods: {
    }
  });

  RadosGatewayShare.associate = function({Cluster}) {
    RadosGatewayShare.Cluster = RadosGatewayShare.belongsTo(Cluster);
  };

  return RadosGatewayShare;
};