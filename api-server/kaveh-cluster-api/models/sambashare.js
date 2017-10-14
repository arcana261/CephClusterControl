"use strict";

const SambaPermission = require('../api/const/SambaPermission');
const SambaStatus = require('../api/const/SambaStatus');

/**
 * @typedef {object} SambaShareModel
 * @property {string} name
 * @property {string} comment
 * @property {boolean} browsable
 * @property {string} guest
 * @property {string} status
 */

module.exports = (sequelize, DataTypes) => {
  const SambaShare = sequelize.define('SambaShare', {
    name: DataTypes.STRING,
    comment: DataTypes.STRING,
    browsable: DataTypes.BOOLEAN,
    guest: {
      type: DataTypes.STRING,
      validation: {
        isIn: [SambaPermission._]
      }
    },
    status: {
      type: DataTypes.STRING,
      validation: {
        isIn: [SambaStatus._]
      }
    }
  }, {
    classMethods: {
    }
  });

  SambaShare.associate = function({SambaAcl, Host, RbdImage, Cluster}) {
    SambaShare.hasMany(SambaAcl);
    SambaShare.Host = SambaShare.belongsTo(Host);
    SambaShare.RbdImage = SambaShare.belongsTo(RbdImage);
    SambaShare.Cluster = SambaShare.belongsTo(Cluster);
  };

  return SambaShare;
};
