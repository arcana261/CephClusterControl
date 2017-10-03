'use strict';

const auth = require('basic-auth');
//const models = require('../../models');
//const User = models.User;
const types = require('./types');

module.exports = {
  basic: function (req, res, key, next) {
    (async () => {
      const {name: userName, pass: password} = auth.parse(req.headers.authorization);

      /*
      const user = yield User.findOne({
        where: {
          userName: userName,
          password: password
        }
      });

      if (!user) {
        throw new Error('username/password invalid');
      }
      */

      req.swagger.auth = {
        //userId: user.id,
        userId: -1,
        userName: userName,
        password: password
      };

      /*
      if ('x-required-role' in req.swagger.operation) {
        let required = req.swagger.operation['x-required-role'];
        if (!types.isArray(required)) {
          required = [required];
        }

        const roles = (yield user.getUserRoles()).map(x => x.role);

        if (!roles.some(x => x !== required)) {
          throw new Error('user does not match required role');
        }

        req.swagger.auth.roles = roles;
      }
      */
    })().then(() => next()).catch(err => next(err));
  }
};
