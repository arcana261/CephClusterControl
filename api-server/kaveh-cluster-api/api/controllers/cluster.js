"use strict";

const restified = require('../helpers/restified');
const {Cluster} = require('../../models');
const except = require('../helpers/except');

module.exports = restified.make({
  /**
   * PATCH /cluster/{clusterName}
   */
  updateCluster: updateCluster,

  /**
   * GET /cluster/{clusterName}
   */
  getCluster: getCluster,

  /**
   * PUT /cluster
   */
  addCluster: addCluster,

  /**
   * GET /cluster
   */
  getClusterList: getClusterList
});

function formatCluster(cluster) {
  return {
    name: cluster.name,
    broker: {
      host: cluster.brokerHost,
      userName: cluster.brokerUserName,
      password: cluster.brokerPassword,
      heartbeat: cluster.brokerHeartBeat,
      topic: cluster.brokerTopic,
      timeout: cluster.brokerTimeout
    }
  };
}

async function updateCluster(t, req, res) {
  const {
    clusterName: {value: clusterName}
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

  const {
    cluster: {value: {
      name: newName = cluster.name,
      broker: {
        host: brokerHost = cluster.brokerHost,
        userName: brokerUserName = cluster.brokerUserName,
        password: brokerPassword = cluster.brokerPassword,
        heartbeat: brokerHeartBeat = cluster.brokerHeartBeat,
        topic: brokerTopic = cluster.brokerTopic,
        timeout: brokerTimeout = cluster.brokerTimeout
      }
    }}
  } = req.swagger.params;

  if (newName !== cluster.name) {
    throw new except.BadRequestError(`can not change cluster name from "${clusterName}" to "${newName}"`);
  }

  await Cluster.update({
    brokerHost: brokerHost,
    brokerUserName: brokerUserName,
    brokerPassword: brokerPassword,
    brokerHeartBeat: brokerHeartBeat,
    brokerTopic: brokerTopic,
    brokerTimeout: brokerTimeout
  }, {
    where: {
      name: clusterName
    }
  });

  res.json({});
}

async function getCluster(req, res) {
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

  res.json(formatCluster(cluster));
}

async function getClusterList(req, res) {
  res.json({
    result: (await Cluster.findAll()).map(cluster => formatCluster(cluster))
  });
}

async function addCluster(req, res) {
  const {
    cluster: {value: {
      name: name,
      broker: {
        host: brokerHost,
        userName: brokerUserName = 'guest',
        password: brokerPassword = 'guest',
        heartbeat: brokerHeartBeat = 10,
        topic: brokerTopic = 'kaveh_cluster_ctrl',
        timeout: brokerTimeout = 2000
      }
    }}
  } = req.swagger.params;

  await Cluster.create({
    name: name,
    brokerHost: brokerHost,
    brokerUserName: brokerUserName,
    brokerPassword: brokerPassword,
    brokerHeartBeat: brokerHeartBeat,
    brokerTopic: brokerTopic,
    brokerTimeout: brokerTimeout
  });

  res.json({});
}
