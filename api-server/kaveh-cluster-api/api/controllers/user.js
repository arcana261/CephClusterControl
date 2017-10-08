"use strict";

const restified = require('../helpers/restified');
const {User} = require('../../models');

module.exports = restified.make({
  getCurrentUser: getCurrentUser
});


async function getCurrentUser(req, res) {
  const {userName, roles} = req.swagger.auth;

  res.json({
    userName: userName,
    password: '',
    roles: roles
  });
}
