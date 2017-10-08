"use strict";

module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define('UserRole', {
    role: DataTypes.STRING
  }, {
    classMethods: {
    }
  });

  UserRole.associate = function({User}) {
    UserRole.User = UserRole.belongsTo(User);
  };

  return UserRole;
};
