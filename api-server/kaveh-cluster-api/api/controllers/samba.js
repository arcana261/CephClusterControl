"use strict";

const restified = require('../helpers/restified');
const except = require('../helpers/except');
const {
  Cluster,
  SambaUser,
  SambaAcl,
  RbdImage,
  Host,
  SambaShare
} = require('../../models');
const SambaPermission = require('../const/SambaPermission');
const SambaAuthUtils = require('../../../../lib/utils/SambaAuthUtils');
const SambaStatus = require('../const/SambaStatus');
const logger = require('logging').default('SambaController');
const ErrorFormatter = require('../../../../lib/utils/ErrorFormatter');
const Retry = require('../../../../lib/utils/Retry');
const config = require('../../config');

module.exports = restified.make({
  /**
   * GET /cluster/{clusterName}/samba
   */
  listSambaShares: listSambaShares,

  /**
   * POST /cluster/{clusterName}/samba/{shareName}
   */
  addSambaShare: addSambaShare,

  /**
   * GET /cluster/{clusterName}/samba/{shareName}
   */
  getSambaShare: getSambaShare,

  /**
   * DELETE /cluster/{clusterName}/samba/{shareName}
   */
  deleteSambaShare: deleteSambaShare,

  /**
   * PATCH /cluster/{clusterName}/samba/{shareName}/comment
   */
  updateSambaShareComment: updateSambaShareComment,

  /**
   * PATCH /cluster/{clusterName}/samba/{shareName}/browsable
   */
  updateSambaShareBrowsable: updateSambaShareBrowsable,

  /**
   * PATCH /cluster/{clusterName}/samba/{shareName}/guest
   */
  updateSambaShareGuestPermission: updateSambaShareGuestPermission,

  /**
   * POST /cluster/{clusterName}/samba/{shareName}/acl
   */
  addSambaShareUser: addSambaShareUser,

  /**
   * DELETE /cluster/{clusterName}/samba/{shareName}/acl/{userName}
   */
  deleteSambaShareUser: deleteSambaShareUser,

  /**
   * PATCH /cluster/{clusterName}/samba/{shareName}/acl/{userName}/password
   */
  updateSambaShareUserPassword: updateSambaShareUserPassword,

  /**
   * PATCH /cluster/{clusterName}/samba/{shareName}/acl/{userName}/permission
   */
  updateSambaShareUserPermission: updateSambaShareUserPermission,

  /**
   * PATCH /cluster/{clusterName}/samba/{shareName}/capacity
   */
  extendSambaShare: extendSambaShare
});

/**
 * @param {*} t
 * @param {ClusterModel} cluster
 * @param {SambaShareModel} share
 */
async function formatSambaShare(t, cluster, share) {
  const image = share.RbdImage || (await share.getRbdImage({transaction: t}));
  const host = share.Host || (await share.getHost({transaction: t}));
  const aclList = await share.getSambaAcls({
    include: [{
      model: SambaUser
    }],
    transaction: t
  });

  return {
    name: share.name,
    comment: share.comment,
    browsable: share.browsable,
    image: image ? image.image : '',
    pool: image ? image.pool : '',
    capacity: image ? image.capacity : 0,
    used: image ? image.used : 0,
    cluster: cluster.name,
    host: host ? host.hostName : '',
    status: share.status,
    guest: share.guest,
    acl: aclList.map(x => ({
      userName: x.SambaUser.userName,
      password: x.SambaUser.password,
      permission: x.permission
    }))
  };
}

async function extendSambaShare(req, res) {
  const {
    clusterName: {value: clusterName},
    shareName: {value: shareName},
    capacity: {value: {
      capacity: capacity
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  let rbdImage = null;
  let host = null;
  let share = null;

  const preconditionChecker = restified.autocommit(async t => {
    share = (await cluster.getSambaShares({
      where: {
        name: shareName
      },
      include: [{
        model: RbdImage
      }, {
        model: Host
      }],
      limit: 1,
      offset: 0,
      transaction: t
    }))[0];

    if (!share) {
      throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
    }

    rbdImage = share.RbdImage;
    host = share.Host;
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        await proxy.samba.extend(shareName, capacity);
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      const info = await Retry.run(async () => {
        return await proxy.rbd.info({
          image: rbdImage.image,
          pool: rbdImage.pool,
          host: host.hostName,
          timeout: 30000
        });
      }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

      const gn = restified.autocommit(async t => {
        Object.assign(rbdImage, {
          capacity: Math.round(info.diskSize || rbdImage.capacity),
          used: Math.round(info.diskUsed || rbdImage.used)
        });

        await rbdImage.save({transaction: t});

        return await formatSambaShare(t, cluster, share);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function updateSambaShareUserPermission(req, res) {
  const {
    clusterName: {value: clusterName},
    shareName: {value: shareName},
    userName: {value: userName},
    permission: {value: {
      permission: permission
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [share] = await cluster.getSambaShares({
      where: {
        name: shareName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!share) {
      throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
    }

    const [acl] = await share.getSambaAcls({
      include: [{
        model: SambaUser,
        where: {
          userName: userName
        },
        transaction: t
      }]
    });

    if (!acl) {
      throw new except.NotFoundError(`username "${userName}" not found for share "${shareName}" in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        const actualUser = await proxy.samba.getUser(shareName, userName);
        actualUser.permission = SambaAuthUtils.parsePermission(permission);
        await proxy.samba.editUser(shareName, userName, actualUser);
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      const gn = restified.autocommit(async t => {
        const [share] = await cluster.getSambaShares({
          where: {
            name: shareName
          },
          limit: 1,
          offset: 0,
          transaction: t
        });

        if (!share) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }

        const [acl] = await share.getSambaAcls({
          include: [{
            model: SambaUser,
            where: {
              userName: userName
            },
            transaction: t
          }]
        });

        if (!acl) {
          throw new except.NotFoundError(`username "${userName}" not found for share "${shareName}" in cluster "${clusterName}"`);
        }

        const user = acl.SambaUser;

        Object.assign(user, {
          permission: permission
        });

        await user.save({transaction: t});

        return {};
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function updateSambaShareUserPassword(req, res) {
  const {
    clusterName: {value: clusterName},
    shareName: {value: shareName},
    userName: {value: userName},
    password: {value: {
      password: password
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [share] = await cluster.getSambaShares({
      where: {
        name: shareName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!share) {
      throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
    }

    const [acl] = await share.getSambaAcls({
      include: [{
        model: SambaUser,
        where: {
          userName: userName
        },
        transaction: t
      }]
    });

    if (!acl) {
      throw new except.NotFoundError(`username "${userName}" not found for share "${shareName}" in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        const actualUser = await proxy.samba.getUser(shareName, userName);
        actualUser.password = password;
        await proxy.samba.editUser(shareName, userName, actualUser);
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      const gn = restified.autocommit(async t => {
        const [share] = await cluster.getSambaShares({
          where: {
            name: shareName
          },
          limit: 1,
          offset: 0,
          transaction: t
        });

        if (!share) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }

        const [acl] = await share.getSambaAcls({
          include: [{
            model: SambaUser,
            where: {
              userName: userName
            },
            transaction: t
          }]
        });

        if (!acl) {
          throw new except.NotFoundError(`username "${userName}" not found for share "${shareName}" in cluster "${clusterName}"`);
        }

        const user = acl.SambaUser;

        Object.assign(user, {
          password: password
        });

        await user.save({transaction: t});

        return {};
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function deleteSambaShareUser(req, res) {
  const {
    clusterName: {value: clusterName},
    shareName: {value: shareName},
    userName: {value: userName}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [share] = await cluster.getSambaShares({
      where: {
        name: shareName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!share) {
      throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
    }

    const [acl] = await share.getSambaAcls({
      include: [{
        model: SambaUser,
        where: {
          userName: userName
        },
        transaction: t
      }]
    });

    if (!acl) {
      throw new except.NotFoundError(`username "${userName}" not found for share "${shareName}" in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        await proxy.samba.delUser(shareName, userName);
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      const gn = restified.autocommit(async t => {
        const [share] = await cluster.getSambaShares({
          where: {
            name: shareName
          },
          limit: 1,
          offset: 0,
          transaction: t
        });

        if (!share) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }

        const [acl] = await share.getSambaAcls({
          include: [{
            model: SambaUser,
            where: {
              userName: userName
            }
          }],
          transaction: t
        });

        if (!acl) {
          throw new except.NotFoundError(`username "${userName}" not found for share "${shareName}" in cluster "${clusterName}"`);
        }

        const user = acl.SambaUser;

        await acl.destroy({transaction: t});

        const aclCount = (await user.getSambaAcls({
          transaction: t,
          limit: 1,
          offset: 0
        })).length;

        if (aclCount < 1) {
          await user.destroy({transaction: t});
        }

        return {};
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function addSambaShareUser(req, res) {
  const {
    clusterName: {value: clusterName},
    shareName: {value: shareName},
    acl: {value: {
      permission: permission,
      userName: userName,
      password: password
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  let effectivePassword = password;

  const preconditionChecker = restified.autocommit(async t => {
    const [share] = await cluster.getSambaShares({
      where: {
        name: shareName
      },
      include: [{
        model: Host
      }],
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!share) {
      throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
    }

    const [user] = await share.Host.getSambaUsers({
      where: {
        userName: userName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (user) {
      effectivePassword = user.password;
    }
    else {
      const acls = await share.getSambaAcls({
        include: [{
          model: SambaUser,
          where: {
            userName: userName
          }
        }],
        limit: 1,
        offset: 0,
        transaction: t
      });

      if (acls.length > 0) {
        throw new except.ConflictError(`user "${userName}" already exists for share "${shareName}" in cluster "${clusterName}"`);
      }
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        await proxy.samba.addUser(shareName, userName, {
          password: effectivePassword,
          permission: SambaAuthUtils.parsePermission(permission)
        });
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      const gn = restified.autocommit(async t => {
        const [share] = await cluster.getSambaShares({
          where: {
            name: shareName
          },
          include: [{
            model: Host
          }],
          limit: 1,
          offset: 0,
          transaction: t
        });

        if (!share) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }

        let [user] = await share.Host.getSambaUsers({
          where: {
            userName: userName
          },
          limit: 1,
          offset: 0,
          transaction: t
        });

        if (!user) {
          user = await SambaUser.create({
            userName: userName,
            password: effectivePassword
          }, {transaction: t});

          await user.setHost(share.Host, {transaction: t});
        }
        else {
          const acls = await share.getSambaAcls({
            include: [{
              model: SambaUser,
              where: {
                userName: userName
              }
            }],
            limit: 1,
            offset: 0,
            transaction: t
          });

          if (acls.length > 0) {
            throw new except.ConflictError(`user "${userName}" already exists for share "${shareName}" in cluster "${clusterName}"`);
          }
        }

        const acl = await SambaAcl.create({
          permission: permission
        }, {transaction: t});

        await acl.setSambaUser(user, {transaction: t});
        await acl.setSambaShare(share, {transaction: t});

        return {};
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function updateSambaShareGuestPermission(req, res) {
  const {
    clusterName: {value: clusterName},
    shareName: {value: shareName},
    permission: {value: {
      permission: permission
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [share] = await cluster.getSambaShares({
      where: {
        name: shareName
      },
      transaction: t,
      limit: 1,
      offset: 0
    });

    if (!share) {
      throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      let actualShare = null;

      try {
        actualShare = await proxy.samba.getShare(shareName);
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      actualShare.guest = SambaAuthUtils.parsePermission(permission);

      try {
        await proxy.samba.update(actualShare);
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      const gn = restified.autocommit(async t => {
        const [share] = await cluster.getSambaShares({
          where: {
            name: shareName
          },
          transaction: t
        });

        if (!share) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }

        Object.assign(share, {
          guest: permission
        });
        await share.save({transaction: t});

        return {};
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function updateSambaShareComment(req, res) {
  const {
    clusterName: {value: clusterName},
    shareName: {value: shareName},
    comment: {value: {
      comment: comment
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [share] = await cluster.getSambaShares({
      where: {
        name: shareName
      },
      transaction: t,
      limit: 1,
      offset: 0
    });

    if (!share) {
      throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      let actualShare = null;

      try {
        actualShare = await proxy.samba.getShare(shareName);
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      actualShare.comment = comment;

      try {
        await proxy.samba.update(actualShare);
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      const gn = restified.autocommit(async t => {
        const [share] = await cluster.getSambaShares({
          where: {
            name: shareName
          },
          transaction: t
        });

        if (!share) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }

        Object.assign(share, {
          comment: comment
        });
        await share.save({transaction: t});

        return {};
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function updateSambaShareBrowsable(req, res) {
  const {
    clusterName: {value: clusterName},
    shareName: {value: shareName},
    browsable: {value: {
      browsable: browsable
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [share] = await cluster.getSambaShares({
      where: {
        name: shareName
      },
      transaction: t,
      limit: 1,
      offset: 0
    });

    if (!share) {
      throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      let actualShare = null;

      try {
        actualShare = await proxy.samba.getShare(shareName);
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      actualShare.browsable = browsable;

      try {
        await proxy.samba.update(actualShare);
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      const gn = restified.autocommit(async t => {
        const [share] = await cluster.getSambaShares({
          where: {
            name: shareName
          },
          transaction: t
        });

        if (!share) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }

        Object.assign(share, {
          browsable: browsable
        });
        await share.save({transaction: t});

        return {};
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function deleteSambaShare(req, res) {
  const {
    clusterName: {value: clusterName},
    shareName: {value: shareName}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [share] = await cluster.getSambaShares({
      where: {
        name: shareName
      },
      transaction: t,
      limit: 1,
      offset: 0
    });

    if (!share) {
      throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        await proxy.samba.del(shareName);
      }
      catch (err) {
        if ((err instanceof Error) && err.message.indexOf('share not found') >= 0) {
          logger.warn(ErrorFormatter.format(err));
        }
        else {
          throw err;
        }
      }

      const gn = restified.autocommit(async t => {
        const [share] = await cluster.getSambaShares({
          where: {
            name: shareName
          },
          transaction: t,
          limit: 1,
          offset: 0
        });

        if (!share) {
          throw new except.NotFoundError(`share "${shareName}" not found in cluster "${clusterName}"`);
        }

        const users = (await share.getSambaAcls({
          transaction: t,
          include: [{
            model: SambaUser
          }]
        })).map(x => x.SambaUser);

        await share.destroy({transaction: t});

        for (const user of users) {
          const acls = await user.getSambaAcls({transaction: t, limit: 1, offset: 0});

          if (acls.length < 1) {
            await user.destroy({transaction: t});
          }
        }

        return {};
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function getSambaShare(t, req, res) {
  const {
    clusterName: {value: clusterName},
    shareName: {value: shareName}
  } = req.swagger.params;

  const share = await SambaShare.findOne({
    where: {
      name: shareName
    },
    include: [{
      model: Cluster,
      where: {
        name: clusterName
      }
    }, {
      model: RbdImage
    }, {
      model: Host
    }],
    transaction: t
  });

  if (!share) {
    throw new except.NotFoundError(`samba share "${shareName}" not found in cluster "${clusterName}"`);
  }

  res.json(await formatSambaShare(t, share.Cluster, share));
}

async function listSambaShares(t, req, res) {
  const {
    clusterName: {value: clusterName},
    start: {value: start},
    length: {value: length}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    },
    transaction: t
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  const shares = await cluster.getSambaShares({
    limit: length,
    start: start,
    transaction: t,
    include: [{
      model: RbdImage
    }, {
      model: Host
    }]
  });

  res.json({
    result: await Promise.all(shares.map(x => formatSambaShare(t, cluster, x)))
  });
}

async function addSambaShare(req, res) {
  const {
    clusterName: {value: clusterName},
    shareName: {value: shareName},
    share: {value: {
      image: image,
      pool: pool,
      host: hostName,
      browsable: browsable = false,
      comment: comment = '',
      guest: guest = SambaPermission.denied,
      acl: acl = []
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const host = await Host.findOne({
      where: {
        hostName: hostName
      },
      include: [{
        model: Cluster,
        where: {
          name: clusterName
        }
      }],
      transaction: t
    });

    if (!host) {
      throw new except.NotFoundError(`host "${host}" not found in cluster "${clusterName}"`);
    }

    const rbdImage = await RbdImage.findOne({
      where: {
        image: image,
        pool: pool
      },
      include: [{
        model: Cluster,
        where: {
          name: clusterName
        }
      }],
      transaction: t
    });

    if (!rbdImage) {
      throw new except.NotFoundError(`rbd image "${pool}/${image}" not found in cluster "${clusterName}"`);
    }

    if ((await rbdImage.getSambaShare({transaction: t})) !== null) {
      throw new except.ConflictError(`rbd image "${pool}/${image}" is already bound to another samba share`);
    }

    if ((await rbdImage.getScsiTarget({transaction: t})) !== null) {
      throw new except.ConflictError(`rbd image "${pool}/${image}" is already bound to another iscsi share`);
    }

    const share = await SambaShare.findOne({
      where: {
        name: shareName
      },
      include: [{
        model: Cluster,
        where: {
          name: clusterName
        }
      }],
      transaction: t
    });

    if (share) {
      throw new except.ConflictError(`samba share "${shareName}" already exists in cluster "${clusterName}"`);
    }

    for (const aclNode of acl) {
      const [user] = await host.getSambaUsers({
        where: {
          userName: aclNode.userName
        },
        limit: 1,
        offset: 0,
        transaction: t
      });

      if (user) {
        aclNode.password = user.password;
      }
    }
  });

  await preconditionChecker();

  const share = {
    image: image,
    pool: pool,
    id: 'admin',
    guest: SambaAuthUtils.parsePermission(guest),
    acl: acl.map(x => ({
      [x.userName]: {
        permission: SambaAuthUtils.parsePermission(x.permission),
        password: x.password
      }
    })).reduce((prev, cur) => Object.assign(prev, cur), {}),
    name: shareName,
    comment: comment,
    browsable: browsable,
    capacity: null,
    used: null,
    host: hostName
  };

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.samba.add(share, hostName);

      const gn = restified.autocommit(async t => {
        const [host] = await cluster.getHosts({
          where: {
            hostName: hostName
          },
          transaction: t
        });

        if (!host) {
          throw new except.NotFoundError(`host "${host}" not found in cluster "${clusterName}"`);
        }

        const [rbdImage] = await cluster.getRbdImages({
          where: {
            image: image,
            pool: pool
          },
          transaction: t
        });

        if (!rbdImage) {
          throw new except.NotFoundError(`rbd image "${pool}/${image}" not found in cluster "${clusterName}"`);
        }

        const share = await SambaShare.create({
          name: shareName,
          comment: comment,
          browsable: browsable,
          guest: guest,
          status: SambaStatus.up
        }, {transaction: t});

        await share.setCluster(cluster, {transaction: t});
        await share.setHost(host, {transaction: t});
        await share.setRbdImage(rbdImage, {transaction: t});

        for (let {userName, password, permission} of acl) {
          let [user] = await host.getSambaUsers({
            where: {
              userName: userName
            },
            transaction: t,
            limit: 1,
            offset: 0
          });

          if (!user) {
            user = await SambaUser.create({
              userName: userName,
              password: password
            }, {transaction: t});

            await user.setHost(host, {transaction: t});
          }
          else {
            password = user.password;
          }

          const aclInstance = await SambaAcl.create({
            permission: permission
          }, {transaction: t});

          await aclInstance.setSambaUser(user, {transaction: t});
          await aclInstance.setSambaShare(share, {transaction: t});
        }

        return await formatSambaShare(t, cluster, share);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}
