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
  addRgwShare: addRgwShare
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
    status: share.status
  };
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
