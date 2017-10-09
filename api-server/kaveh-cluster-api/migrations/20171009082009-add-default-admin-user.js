"use strict";

const {User, Role} = require('../models');
const PasswordHash = require('../../../lib/utils/PasswordHash');
const sql = require('../api/helpers/sql');

module.exports = sql.modernize({
  up: async (t, queryInterface, Sequelize) => {
    const adminRole = await Role.create({name: 'admin'}, {transaction: t});
    const userRole = await Role.create({name: 'user'}, {transaction: t});

    const admin = await User.create({
      userName: 'admin',
      password: await PasswordHash.create('admin')
    }, {transaction: t});

    await admin.addRoles([adminRole, userRole], {transaction: t});
  },

  down: async (t, queryInterface, Sequelize) => {
    await User.destroy({
      where: {
        userName: 'admin'
      },
      transaction: t
    });

    await Role.destroy({
      where: {
        name: 'admin'
      },
      transaction: t
    });

    await Role.destroy({
      where: {
        name: 'user'
      },
      transaction: t
    });
  }
});
