"use strict";

const restified = require('../helpers/restified');
const {Cluster, Host, RpcType} = require('../../models');
const except = require('../helpers/except');
const ClusterUpdater = require('../service/ClusterUpdater');
const Retry = require('../../../../lib/utils/Retry');
const logger = require('logging').default('HostController');
const ErrorFormatter = require('../../../../lib/utils/ErrorFormatter');
const config = require('../../config');

module.exports = restified.make({
  /**
   * GET /cluster/{clusterName}/host
   */
  listClusterHosts: listClusterHosts,

  /**
   * GET /cluster/{clusterName}/host/{hostName}
   */
  getClusterHost: getClusterHost,

  /**
   * DELETE /cluster/{clusterName}/host/{hostName}
   */
  deleteClusterHost: deleteClusterHost,

  /**
   * POST /cluster/{clusterName}/host
   */
  refreshClusterHosts: refreshClusterHosts,

  /**
   * /host/types
   */
  getHostTypes: getHostTypes
});

/**
 * @param {ClusterModel} cluster
 * @param {HostModel} host
 * @param {Array.<RpcType>} types
 */
function formatHost(cluster, host, types) {
  return {
    cluster: cluster.name,
    types: types.map(x => x.name),
    hostname: host.hostName,
    version: host.version,
    ip: JSON.parse(host.ipList).list,
    distro: {
      centos: host.distro_centos,
      ubuntu: host.distro_ubuntu,
      version: host.distro_version
    },
    status: host.status
  };
}

/**
 * @param {*} t
 * @param {string} clusterName
 * @param {string} hostName
 * @returns {Promise.<HostModel>}
 */
async function findHost(t, clusterName, hostName) {
  const host = await Host.findOne({
    where: {
      hostName: hostName
    },
    include: [{
      model: Cluster,
      where: {
        name: clusterName
      }
    }, {
      model: RpcType
    }],
    transaction: t
  });

  if (!host) {
    throw new except.NotFoundError(`host "${hostName}" not found in cluster "${clusterName}"`);
  }

  return host;
}

async function getHostTypes(t, req, res) {
  const types = await RpcType.findAll({transaction: t});

  res.json({
    result: types.map(type => type.name)
  });
}

async function refreshClusterHosts(req, res) {
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
      const hosts = await updater.updateHosts(cluster, proxy);
      await updater.updateScsiHosts(cluster, proxy, hosts);

      return {};
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function deleteClusterHost(t, req, res) {
  const {
    clusterName: {value: clusterName},
    hostName: {value: hostName}
  } = req.swagger.params;

  const host = await findHost(t, clusterName, hostName);
  await host.destroy({transaction: t});

  res.json({});
}

async function getClusterHost(t, req, res) {
  const {
    clusterName: {value: clusterName},
    hostName: {value: hostName}
  } = req.swagger.params;

  const host = await findHost(t, clusterName, hostName);

  res.json(formatHost(host.Cluster, host, host.RpcTypes));
}

async function listClusterHosts(t, req, res) {
  const {
    clusterName: {value: clusterName},
    start: {value: start = req.swagger.params.start.schema.default},
    length: {value: length = req.swagger.params.length.schema.default},
    type: {value: type = null}
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

  let hosts = null;

  if (!type) {
    hosts = await cluster.getHosts({
      include: [{
        model: RpcType,
      }],
      transaction: t,
      limit: length,
      offset: start
    });
  }
  else {
    const rpcType = await RpcType.findOne({
      where: {
        name: type
      },
      include: [{
        model: Host,
        include: [{
          model: Cluster,
          where: {
            name: clusterName
          }
        }]
      }],
      transaction: t
    });

    if (!rpcType) {
      hosts = [];
    }
    else {
      hosts = rpcType.Hosts;

      for (const host of hosts) {
        host.RpcTypes = await host.getRpcTypes({transaction: t});
      }
    }
  }

  res.json({
    result: hosts.map(host => formatHost(cluster, host, host.RpcTypes))
  });
}
