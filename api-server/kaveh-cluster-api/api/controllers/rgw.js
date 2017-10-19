"use strict";

const restified = require('../helpers/restified');
const except = require('../helpers/except');
const Retry = require('../../../../lib/utils/Retry');
const config = require('../../config');
const ErrorFormatter = require('../../../../lib/utils/ErrorFormatter');
const ClusterUpdater = require('../service/ClusterUpdater');
const logger = require('logging').default('RgwController');

const {
  Cluster, RadosGatewayShare
} = require('../../models');

module.exports = restified.make({
  /**
   * GET /cluster/{clusterName}/rgw
   */
  listRgwShares: listRgwShares,

  /**
   * GET /cluster/{clusterName}/rgw/{userName}
   */
  getRgwShare: getRgwShare,

  /**
   * PUT /cluster/{clusterName}/rgw
   */
  addRgwShare: addRgwShare,

  /**
   * POST /cluster/{clusterName}/rgw/{userName}/quota
   */
  setRgwQuota: setRgwQuota,

  /**
   * DELETE /cluster/{clusterName}/rgw/{userName}/quota
   */
  deleteRgwQuota: deleteRgwQuota,

  /**
   * DELETE /cluster/{clusterName}/rgw/{userName}
   */
  deleteRgwShare: deleteRgwShare,

  /**
   * POST /cluster/{clusterName}/rgw/refresh
   */
  refreshRgwShares: refreshRgwShares,

  /**
   * PATCH /cluster/{clusterName}/rgw/{userName}/fullName
   */
  updateRgwFullName: updateRgwFullName,

  /**
   * PATCH /cluster/{clusterName}/rgw/{userName}/fullName
   */
  updateRgwEmail: updateRgwEmail,

  /**
   * POST /cluster/{clusterName}/rgw/{userName}/suspention
   */
  suspendRgwUser: suspendRgwUser,

  /**
   * DELETE /cluster/{clusterName}/rgw/{userName}/suspention
   */
  unsuspendRgwUser: unsuspendRgwUser
});

/**
 * @param {RadosGatewayShareModel} share
 */
function formatRgwShare(share) {
  if (!share) {
    throw new except.NotFoundError(`rgw share not found`);
  }

  return {
    userName: share.userName,
    fullName: share.fullName,
    email: share.email,
    accessKey: share.accessKey,
    secretKey: share.secretKey,
    hasQuota: share.hasQuota,
    capacity: share.capacity || 0,
    used: share.used || 0,
    status: share.status,
    suspended: share.suspended || false
  };
}

async function unsuspendRgwUser(req, res) {
  const {
    clusterName: {value: clusterName},
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
    const [share] = await cluster.getRadosGatewayShares({
      where: {
        userName: userName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!share) {
      throw new except.NotFoundError(`rgw share "${userName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.rgw.unsuspend(userName, {timeout: ClusterUpdater.ExtendedTimeoutValue});

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateRadosGatewayShares(cluster, proxy, {
        shareNames: [userName]
      });

      return formatRgwShare(result[0]);
    });

    return await fn();
  });

  res.json(result);
}

async function suspendRgwUser(req, res) {
  const {
    clusterName: {value: clusterName},
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
    const [share] = await cluster.getRadosGatewayShares({
      where: {
        userName: userName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!share) {
      throw new except.NotFoundError(`rgw share "${userName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.rgw.suspend(userName, {timeout: ClusterUpdater.ExtendedTimeoutValue});

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateRadosGatewayShares(cluster, proxy, {
        shareNames: [userName]
      });

      return formatRgwShare(result[0]);
    });

    return await fn();
  });

  res.json(result);
}

async function updateRgwEmail(req, res) {
  const {
    clusterName: {value: clusterName},
    userName: {value: userName},
    updateData: {value: {
      email: email
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
    const [share] = await cluster.getRadosGatewayShares({
      where: {
        userName: userName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!share) {
      throw new except.NotFoundError(`rgw share "${userName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.rgw.update(userName, {
        email: email,
        timeout: ClusterUpdater.ExtendedTimeoutValue
      });

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateRadosGatewayShares(cluster, proxy, {
        shareNames: [userName]
      });

      return formatRgwShare(result[0]);
    });

    return await fn();
  });

  res.json(result);
}

async function updateRgwFullName(req, res) {
  const {
    clusterName: {value: clusterName},
    userName: {value: userName},
    updateData: {value: {
      fullName: fullName
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
    const [share] = await cluster.getRadosGatewayShares({
      where: {
        userName: userName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!share) {
      throw new except.NotFoundError(`rgw share "${userName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.rgw.update(userName, {
        fullName: fullName,
        timeout: ClusterUpdater.ExtendedTimeoutValue
      });

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateRadosGatewayShares(cluster, proxy, {
        shareNames: [userName]
      });

      return formatRgwShare(result[0]);
    });

    return await fn();
  });

  res.json(result);
}

async function refreshRgwShares(req, res) {
  const {
    clusterName: {value: clusterName}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found`);
  }

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      const updater = new ClusterUpdater(clusterName);
      await updater.updateRadosGatewayShares(cluster, proxy);

      return {};
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function deleteRgwShare(req, res) {
  const {
    clusterName: {value: clusterName},
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
    const [share] = await cluster.getRadosGatewayShares({
      where: {
        userName: userName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!share) {
      throw new except.NotFoundError(`rgw share "${userName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        await proxy.rgw.del(userName, {timeout: ClusterUpdater.ExtendedTimeoutValue});
      }
      catch (err) {
      }

      const gn = restified.autocommit(async t => {
        const [share] = await cluster.getRadosGatewayShares({
          where: {
            userName: userName
          },
          limit: 1,
          offset: 0,
          transaction: t
        });

        if (!share) {
          throw new except.NotFoundError(`cluster "${clusterName}" not found`);
        }

        await share.destroy({transaction: t});

        return {};
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function deleteRgwQuota(req, res) {
  const {
    clusterName: {value: clusterName},
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
    const [share] = await cluster.getRadosGatewayShares({
      where: {
        userName: userName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!share) {
      throw new except.NotFoundError(`rgw share "${userName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.rgw.disableQuota(userName, {timeout: ClusterUpdater.ExtendedTimeoutValue});

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateRadosGatewayShares(cluster, proxy, {
        shareNames: [userName]
      });

      return formatRgwShare(result[0]);
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function setRgwQuota(req, res) {
  const {
    clusterName: {value: clusterName},
    userName: {value: userName},
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

  const preconditionChecker = restified.autocommit(async t => {
    const [share] = await cluster.getRadosGatewayShares({
      where: {
        userName: userName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!share) {
      throw new except.NotFoundError(`rgw share "${userName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.rgw.enableQuota(userName, capacity, {timeout: ClusterUpdater.ExtendedTimeoutValue});

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateRadosGatewayShares(cluster, proxy, {
        shareNames: [userName]
      });

      return formatRgwShare(result[0]);
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function addRgwShare(req, res) {
  const {
    clusterName: {value: clusterName},
    share: {value: {
      userName: userName,
      fullName: fullName,
      email: email
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
    const [share] = await cluster.getRadosGatewayShares({
      where: {
        userName: userName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (share) {
      throw new except.ConflictError(`rgw share "${userName}" already exists in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.rgw.add({
        username: userName,
        displayName: fullName,
        email: email,
        timeout: ClusterUpdater.ExtendedTimeoutValue
      });

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateRadosGatewayShares(cluster, proxy, {
        shareNames: [userName]
      });

      return formatRgwShare(result[0]);
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function getRgwShare(t, req, res) {
  const {
    clusterName: {value: clusterName},
    userName: {value: userName}
  } = req.swagger.params;

  const share = await RadosGatewayShare.findOne({
    include: [{
      model: Cluster,
      where: {
        name: clusterName
      }
    }],
    where: {
      userName: userName
    },
    transaction: t
  });

  if (!share) {
    throw new except.NotFoundError(`rgw share "${userName}" not found in cluster "${clusterName}"`);
  }

  res.json(formatRgwShare(share));
}

async function listRgwShares(t, req, res) {
  const {
    clusterName: {value: clusterName},
    start: {value: start = req.swagger.params.start.schema.default},
    length: {value: length = req.swagger.params.length.schema.length}
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

  const result = await cluster.getRadosGatewayShares({
    transaction: t,
    limit: length,
    offset: start
  });

  res.json({
    result: result.map(share => formatRgwShare(share))
  });
}
