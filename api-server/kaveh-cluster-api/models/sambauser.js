"use strict";

/**
 * @typedef {object} SambaUserModel
 * @property {string} userName
 * @property {string} password
 */

module.exports = (sequelize, DataTypes) => {
  const SambaUser = sequelize.define('SambaUser', {
    userName: DataTypes.STRING,
    password: DataTypes.STRING
  }, {
    classMethods: {
    }
  });

  SambaUser.associate = function({Host, SambaAcl}) {
    SambaUser.Host = SambaUser.belongsTo(Host);
    SambaUser.hasMany(SambaAcl);
  };

  return SambaUser;
};