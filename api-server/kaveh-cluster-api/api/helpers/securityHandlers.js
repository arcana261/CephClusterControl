'use strict';

const auth = require('basic-auth');
const PasswordHash = require('../../../../lib/utils/PasswordHash');
const {User, UserRole, sequelize} = require('../../models');
const types = require('./types');
const redis = require('./redis');

module.exports = {
  basic: function (req, res, key, next) {
    (async () => {
      const cached = await redis.get().get(redis.createKey(['securityHandler', req.headers.authorization]));

      if (cached) {
        try {
          req.swagger.auth = JSON.parse(cached);
        }
        catch (err) {
        }
      }

      if (req.swagger.auth) {
        if ('x-required-role' in req.swagger.operation) {
          let required = req.swagger.operation['x-required-role'];
          if (!types.isArray(required)) {
            required = [required];
          }

          const roles = req.swagger.auth.roles;

          if (!types.isArray(roles) || !required.every(x => roles.indexOf(x) >= 0)) {
            throw new Error('user does not match required role');
          }
        }
      }
      else {
        const {name: userName, pass: password} = auth.parse(req.headers.authorization);

        let user = await User.findOne({
          where: {
            userName: userName
          }
        });

        if (!user) {
          throw new Error('username/password invalid');
        }

        if (!(await PasswordHash.verify(user.password, password))) {
          throw new Error('username/password invalid');
        }

        req.swagger.auth = {
          userId: user.id,
          userName: userName,
          roles: (await user.getRoles()).map(x => x.name)
        };

        if ('x-required-role' in req.swagger.operation) {
          let required = req.swagger.operation['x-required-role'];
          if (!types.isArray(required)) {
            required = [required];
          }

          if (!required.every(x => req.swagger.auth.roles.indexOf(x) >= 0)) {
            throw new Error('user does not match required role');
          }
        }

        await redis.get().set(
          redis.createKey(['securityHandler', req.headers.authorization]),
          JSON.stringify(req.swagger.auth),
          {expire: 3600});
      }
    })().then(() => next()).catch(err => next(err));
  }
};
