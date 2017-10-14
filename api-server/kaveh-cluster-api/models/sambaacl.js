"use strict";

const SambaPermission = require('../api/const/SambaPermission');

/**
 * @typedef {object} SambaAclModel
 * @property {string} permission
 */

module.exports = (sequelize, DataTypes) => {
  const SambaAcl = sequelize.define('SambaAcl', {
    permission: {
      type: DataTypes.STRING,
      validation: {
        isIn: [SambaPermission._]
      }
    }
  }, {
    classMethods: {
    }
  });

  SambaAcl.associate = function({SambaUser, SambaShare}) {
    SambaAcl.SambaUser = SambaAcl.belongsTo(SambaUser);
    SambaAcl.SambaShare = SambaAcl.belongsTo(SambaShare);
  };

  return SambaAcl;
};
