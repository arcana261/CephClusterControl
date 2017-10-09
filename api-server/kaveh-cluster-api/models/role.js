'use strict';
module.exports = (sequelize, DataTypes) => {
  var Role = sequelize.define('Role', {
    name: DataTypes.STRING
  }, {
    classMethods: {
    }
  });

  Role.associate = function({User}) {
    Role.belongsToMany(User, {through: 'UserRole'})
  };

  return Role;
};