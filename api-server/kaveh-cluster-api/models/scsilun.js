"use strict";

const ScsiLunStatus = require('../api/const/ScsiLunStatus');

/**
 * @typedef {object} ScsiLun
 * @property {number} size
 * @property {string} status
 * @property {number} index
 */

module.exports = (sequelize, DataTypes) => {
  const ScsiLun = sequelize.define('ScsiLun', {
    size: DataTypes.INTEGER,
    status: {
      type: DataTypes.STRING,
      validate: {
        isIn: [ScsiLunStatus._]
      }
    },
    index: DataTypes.INTEGER
  }, {
    classMethods: {
    }
  });

  ScsiLun.associate = function({ScsiTarget}) {
    ScsiLun.ScsiTarget = ScsiLun.belongsTo(ScsiTarget);
  };

  return ScsiLun;
};