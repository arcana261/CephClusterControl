"use strict";

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    userName: DataTypes.STRING,
    password: DataTypes.STRING
  }, {
    classMethods: {
    }
  });

  User.associate = function({Role}) {
    User.belongsToMany(Role, {through: 'UserRole'});
  };

  return User;
};