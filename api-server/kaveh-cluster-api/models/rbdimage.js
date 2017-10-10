"use strict";

const RbdImageStatus = require('../api/const/RbdImageStatus');

/**
 * @typedef {object} RbdImageModel
 * @property {string} pool
 * @property {string} image
 * @property {number} capacity
 * @property {number} used
 * @property {string} fileSystem
 * @property {boolean} isMounted
 * @property {string} status
 * @property {string} mountPoint_location
 * @property {number} mountPoint_rbdId
 */

module.exports = (sequelize, DataTypes) => {
  const RbdImage = sequelize.define('RbdImage', {
    pool: DataTypes.STRING,
    image: DataTypes.STRING,
    capacity: DataTypes.INTEGER,
    used: DataTypes.INTEGER,
    fileSystem: DataTypes.STRING,
    isMounted: DataTypes.BOOLEAN,
    status: {
      type: DataTypes.STRING,
      validate: {
        isIn: [RbdImageStatus._]
      }
    },
    mountPoint_location: DataTypes.STRING,
    mountPoint_rbdId: DataTypes.INTEGER,
    mountPoint_device: DataTypes.STRING,
    mountPoint_readOnly: DataTypes.BOOLEAN
  }, {
    classMethods: {
    }
  });

  RbdImage.associate = function({Cluster, Host}) {
    RbdImage.Cluster = RbdImage.belongsTo(Cluster);
    RbdImage.Host = RbdImage.belongsTo(Host);
  };

  return RbdImage;
};