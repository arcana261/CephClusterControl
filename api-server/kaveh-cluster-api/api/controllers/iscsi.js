"use strict";

const restified = require('../helpers/restified');
const except = require('../helpers/except');
const IScsiUtils = require('../../../../lib/utils/IScsiUtils');
const HostStatus = require('../const/HostStatus');
const Retry = require('../../../../lib/utils/Retry');
const ErrorFormatter = require('../../../../lib/utils/ErrorFormatter');
const config = require('../../config');
const logger = require('logging').default('IScsiController');
const ScsiTargetStatus = require('../const/ScsiTargetStatus');
const ScsiLunStatus = require('../const/ScsiLunStatus');
const ClusterUpdater = require('../service/ClusterUpdater');
const ImageNameParser = require('../../../../lib/utils/ImageNameParser');

const {
  Cluster,
  RbdImage,
  ScsiLun, ScsiHost, ScsiTarget,
  Host, RpcType
} = require('../../models');

module.exports = restified.make({
  /**
   * GET /cluster/{clusterName}/iscsi
   */
  listScsiTargets: listScsiTargets,

  /**
   * GET /cluster/{clusterName}/iscsi/host
   */
  listScsiHosts: listScsiHosts,

  /**
   * GET /cluster/{clusterName}/iscsi/host/{hostName}
   */
  getScsiHost: getScsiHost,

  /**
   * DELETE /cluster/{clusterName}/iscsi/host/{hostName}
   */
  deleteScsiHost: deleteScsiHost,

  /**
   * POST /cluster/{clusterName}/iscsi
   */
  addScsiTarget: addScsiTarget,

  /**
   * GET /cluster/{clusterName}/iscsi/{targetName}
   */
  getScsiTarget: getScsiTarget,

  /**
   * DELETE /cluster/{clusterName}/iscsi/{targetName}
   */
  deleteScsiTarget: deleteScsiTarget,

  /**
   * POST /cluster/{clusterName}/iscsi/host/{hostName}/auth
   */
  updateScsiPortalAuthentication: updateScsiPortalAuthentication,

  /**
   * DELETE /cluster/{clusterName}/iscsi/host/{hostName}/auth
   */
  deleteScsiPortalAuthentication: deleteScsiPortalAuthentication,

  /**
   * POST /cluster/{clusterName}/iscsi/{targetName}/auth
   */
  setScsiTargetAuthentication: setScsiTargetAuthentication,

  /**
   * DELETE /cluster/{clusterName}/iscsi/{targetName}/auth
   */
  deleteScsiTargetAuthentication: deleteScsiTargetAuthentication,

  /**
   * PATCH /cluster/{clusterName}/iscsi/{targetName}/capacity
   */
  extendScsiTargetCapacity: extendScsiTargetCapacity,

  /**
   * POST /cluster/{clusterName}/iscsi/{targetName}/lun
   */
  addScsiTargetLun: addScsiTargetLun,

  /**
   * DELETE /cluster/{clusterName}/iscsi/{targetName}/lun
   */
  deleteScsiTargetLun: deleteScsiTargetLun,

  /**
   * POST /cluster/{clusterName}/iscsi/refresh
   */
  refreshScsiShares: refreshScsiShares
});

/**
 * @param {*} t
 * @param {ClusterModel} cluster
 * @param {ScsiTargetModel} target
 * @returns {Promise.<*>}
 */
async function formatScsiTarget(t, cluster, target) {
  if (!target) {
    throw new except.NotFoundError(`target not found in cluster "${cluster.name}"`);
  }

  const luns = target.ScsiLuns || (await target.getScsiLuns({transaction: t}));
  const rbdImage = target.RbdImage || (await target.getRbdImage({transaction: t}));
  const scsiHost = target.ScsiHost || (await target.getScsiHost({
    include: [{
      model: Host
    }],
    transaction: t
  }));
  const host = scsiHost ? (scsiHost.Host || (await scsiHost.getHost({transaction: t}))) : null;
  const iqn = IScsiUtils.parseIqn(target.iqn);

  let domain = '';

  if (iqn.host) {
    if (iqn.domain) {
      domain = `${iqn.host}.${iqn.domain}`;
    }
    else {
      domain = iqn.host;
    }
  }

  return {
    name: iqn.name,
    iqn: {
      year: iqn.year,
      month: iqn.month,
      name: iqn.name,
      domain: domain,
      tag: iqn.tag
    },
    stringifiedIqn: target.iqn,
    authentication: target.requiresAuth ? {
      enabled: true,
      userId: target.userName,
      password: target.password
    } : {
      enabled: false,
      userId: '',
      password: ''
    },
    pool: rbdImage ? rbdImage.pool : '',
    image: rbdImage ? rbdImage.image : '',
    capacity: rbdImage ? rbdImage.capacity : 0,
    used: rbdImage ? rbdImage.used : 0,
    allocated: rbdImage && luns ? luns.reduce((prev, cur) => prev + cur.size, 0) : 0,
    luns: luns ? luns.map(x => ({
      size: x.size,
      status: x.status
    })) : [],
    host: host ? host.hostName : '',
    cluster: cluster.name,
    status: target.suspended ? 'suspended' : target.status
  };
}

/**
 * @param {*} t
 * @param {ClusterModel} cluster
 * @param {ScsiHostModel} scsiHost
 * @returns {Promise.<*>}
 */
async function formatScsiHost(t, cluster, scsiHost) {
  if (!scsiHost) {
    throw new except.NotFoundError(`scsi host not found in cluster "${cluster.name}"`);
  }

  const host = scsiHost.Host || (await scsiHost.getHost({transaction: t}));
  const rpcTypes = host ? (host.RpcTypes || (await host.getRpcTypes({transaction: t}))) : [];

  return {
    discovery: scsiHost.requiresAuth ? {
      enabled: true,
      userId: scsiHost.userName,
      password: scsiHost.password
    } : {
      enabled: false,
      userId: '',
      password: ''
    },
    host: host ? {
      cluster: cluster.name,
      types: rpcTypes.map(x => x.name),
      hostname: host.hostName,
      version: host.version,
      ip: JSON.parse(host.ipList).list,
      distro: {
        centos: host.distro_centos,
        ubuntu: host.distro_ubuntu,
        version: host.distro_version
      },
      status: host.status
    } : {
      cluster: cluster.name,
      types: [],
      hostname: '',
      version: '',
      ip: [],
      distro: {
        centos: false,
        ubuntu: false,
        version: ''
      },
      status: HostStatus.up
    }
  };
}

async function suspendScsiTarget(req, res) {
  const {
    clusterName: {value: clusterName},
    targetName: {value: targetName}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  let scsiHost = null;
  let target = null;

  const preconditionChecker = restified.autocommit(async t => {
    target = (await cluster.getScsiTargets({
      where: {
        name: targetName
      },
      include: [{
        model: ScsiHost,
        include: [{
          model: Host
        }]
      }],
      limit: 1,
      offset: 0,
      transaction: t
    }))[0];

    if (!target) {
      throw new except.NotFoundError(`target "${targetName}" not found in cluster "${clusterName}"`);
    }

    scsiHost = target.ScsiHost;

    if (!scsiHost || !scsiHost.Host) {
      throw new except.NotFoundError(`target "${targetName}" is missing in cluster "${clusterName}"`);
    }

    target.suspended = true;
    await target.save({transaction: t});
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {

    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function refreshScsiShares(req, res) {
  const {
    clusterName: {value: clusterName}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      const updater = new ClusterUpdater(clusterName);

      let hosts = await updater.updateHosts(cluster, proxy);
      let result = await updater.updateScsiHosts(cluster, proxy, hosts);
      result = await updater.updateRbdImages(cluster, proxy, result.hosts);
      await updater.updateScsiTargets(cluster, proxy, result.hosts);

      return {};
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function deleteScsiHost(t, req, res) {
  const {
    clusterName: {value: clusterName},
    hostName: {value: hostName}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  const [scsiHost] = await cluster.getScsiHosts({
    include: [{
      model: Host,
      where: {
        hostName: hostName
      }
    }],
    limit: 1,
    offset: 0,
    transaction: t
  });

  if (!scsiHost) {
    throw new except.NotFoundError(`iscsi host "${hostName}" not found in cluster "${clusterName}"`);
  }

  await scsiHost.destroy({transaction: t});

  res.json({});
}

async function deleteScsiTargetLun(req, res) {
  const {
    clusterName: {value: clusterName},
    targetName: {value: targetName},
    lun: {value: {
      index: index,
      destroyData: destroyData = false
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  let scsiHost = null;
  let lun = null;

  const preconditionChecker = restified.autocommit(async t => {
    const [target] = await cluster.getScsiTargets({
      where: {
        name: targetName
      },
      include: [{
        model: ScsiHost,
        include: [{
          model: Host
        }]
      }],
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!target) {
      throw new except.NotFoundError(`target "${targetName}" not found in cluster "${clusterName}"`);
    }

    scsiHost = target.ScsiHost;

    if (!scsiHost || !scsiHost.Host) {
      throw new except.NotFoundError(`target "${targetName}" is missing in cluster "${clusterName}"`);
    }

    lun = (await target.getScsiLuns({
      transaction: t,
      limit: 1,
      offset: index
    }))[0];

    if (!lun) {
      throw new except.NotFoundError(`iscsi lun with index "${index}" not found ` +
        `for target "${targetName}" in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        await proxy.iscsi.removeLun(targetName, lun.index, {
          host: scsiHost.Host.hostName,
          timeout: ClusterUpdater.ExtendedTimeoutValue,
          usage: false,
          destroyData: destroyData
        });
      }
      catch (err) {
        if (ErrorFormatter.format(err).indexOf('is out of range') < 0) {
          throw err;
        }
      }

      const gn = restified.autocommit(async t => {
        await lun.destroy({transaction: t});

        const [target] = await cluster.getScsiTargets({
          where: {
            name: targetName
          },
          include: [{
            model: ScsiHost,
            include: [{
              model: Host
            }]
          }, {
            model: ScsiLun
          }, {
            model: RbdImage
          }],
          limit: 1,
          offset: 0,
          transaction: t
        });

        if (!target) {
          throw new except.NotFoundError(`target "${targetName}" not found in cluster "${clusterName}"`);
        }

        return await formatScsiTarget(t, cluster, target);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function addScsiTargetLun(req, res) {
  const {
    clusterName: {value: clusterName},
    targetName: {value: targetName},
    size: {value: {
      size: size
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  let scsiHost = null;

  const preconditionChecker = restified.autocommit(async t => {
    const [target] = await cluster.getScsiTargets({
      where: {
        name: targetName
      },
      include: [{
        model: ScsiHost,
        include: [{
          model: Host
        }]
      }],
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!target) {
      throw new except.NotFoundError(`target "${targetName}" not found in cluster "${clusterName}"`);
    }

    scsiHost = target.ScsiHost;

    if (!scsiHost || !scsiHost.Host) {
      throw new except.NotFoundError(`target "${targetName}" is missing in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.iscsi.addLun(targetName, size, {
        host: scsiHost.Host.hostName,
        timeout: ClusterUpdater.ExtendedTimeoutValue,
        usage: false
      });

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateScsiTargets(cluster, proxy, [scsiHost.Host], {
        targets: [targetName]
      });

      const gn = restified.autocommit(async t => {
        return await formatScsiTarget(t, cluster, result.targets[0]);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function extendScsiTargetCapacity(req, res) {
  const {
    clusterName: {value: clusterName},
    targetName: {value: targetName},
    capacity: {value: {
      size: size
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  let rbdImage = null;
  let scsiHost = null;

  const preconditionChecker = restified.autocommit(async t => {
    const [target] = await cluster.getScsiTargets({
      where: {
        name: targetName
      },
      include: [{
        model: RbdImage
      }, {
        model: ScsiHost,
        include: [{
          model: Host
        }]
      }],
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!target) {
      throw new except.NotFoundError(`target "${targetName}" not found in cluster "${clusterName}"`);
    }

    rbdImage = target.RbdImage;
    scsiHost = target.ScsiHost;

    if (!rbdImage) {
      throw new except.NotFoundError(`target "${targetName}" has no associated rbd image in cluster "${clusterName}"`);
    }

    if (!scsiHost || !scsiHost.Host) {
      throw new except.NotFoundError(`target "${targetName}" is missing in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.iscsi.extend(targetName, size, {
        host: scsiHost.Host.hostName,
        timeout: ClusterUpdater.ExtendedTimeoutValue,
        usage: false
      });

      const parsedName = ImageNameParser.parse(rbdImage.image, rbdImage.pool);
      const updater = new ClusterUpdater(clusterName);

      const rbdResult = await updater.updateRbdImages(cluster, proxy, [scsiHost.Host],
        {imageNames: [parsedName.fullName]});

      const scsiResult = await updater.updateScsiTargets(cluster, proxy, [scsiHost.Host],
        {targets: [targetName]});

      const gn = restified.autocommit(async t => {
        return await formatScsiTarget(t, cluster, scsiResult.targets[0]);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function deleteScsiTargetAuthentication(req, res) {
  const {
    clusterName: {value: clusterName},
    targetName: {value: targetName}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  let scsiHost = null;

  const preconditionChecker = restified.autocommit(async t => {
    const [target] = await cluster.getScsiTargets({
      where: {
        name: targetName
      },
      include: [{
        model: ScsiHost,
        include: [{
          model: Host
        }]
      }],
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!target) {
      throw new except.NotFoundError(`target "${targetName}" not found in cluster "${clusterName}"`);
    }

    scsiHost = target.ScsiHost;

    if (!scsiHost || !scsiHost.Host) {
      throw new except.NotFoundError(`target "${targetName}" is missing in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      const actualTarget = await proxy.iscsi.disableAuthentication(targetName, {
        host: scsiHost.Host.hostName,
        timeout: ClusterUpdater.ExtendedTimeoutValue,
        usage: false
      });

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateScsiTargets(cluster, proxy, [scsiHost.Host], {
        targets: [targetName]
      });

      const gn = restified.autocommit(async t => {
        return await formatScsiTarget(t, cluster, result.targets[0]);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function setScsiTargetAuthentication(req, res) {
  const {
    clusterName: {value: clusterName},
    targetName: {value: targetName},
    auth: {value: {
      password: password
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  let scsiHost = null;

  const preconditionChecker = restified.autocommit(async t => {
    const [target] = await cluster.getScsiTargets({
      where: {
        name: targetName
      },
      include: [{
        model: ScsiHost,
        include: [{
          model: Host
        }]
      }],
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!target) {
      throw new except.NotFoundError(`target "${targetName}" not found in cluster "${clusterName}"`);
    }

    scsiHost = target.ScsiHost;

    if (!scsiHost || !scsiHost.Host) {
      throw new except.NotFoundError(`target "${targetName}" is missing in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      const actualTarget = await proxy.iscsi.enableAuthentication(targetName, password, {
        host: scsiHost.Host.hostName,
        timeout: ClusterUpdater.ExtendedTimeoutValue,
        usage: false
      });

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateScsiTargets(cluster, proxy, [scsiHost.Host], {
        targets: [targetName]
      });

      const gn = restified.autocommit(async t => {
        return await formatScsiTarget(t, cluster, result.targets[0]);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function deleteScsiPortalAuthentication(req, res) {
  const {
    clusterName: {value: clusterName},
    hostName: {value: hostName}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  let host = null;

  const preconditionChecker = restified.autocommit(async t => {
    host = (await cluster.getScsiHosts({
      include: [{
        model: Host,
        where: {
          hostName: hostName
        }
      }],
      limit: 1,
      offset: 0,
      transaction: t
    }))[0];

    if (!host) {
      throw new except.NotFoundError(`host "${hostName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.iscsi.disableDiscoveryAuthentication(hostName, {timeout: ClusterUpdater.ExtendedTimeoutValue});

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateScsiHosts(cluster, proxy, [host.Host], {
        isPartialUpdate: true
      });

      const gn = restified.autocommit(async t => {
        return await formatScsiHost(t, cluster, result.scsiHosts[0]);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function updateScsiPortalAuthentication(req, res) {
  const {
    clusterName: {value: clusterName},
    hostName: {value: hostName},
    auth: {value: {
      password: password,
      domain: domain
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  let host = null;

  const preconditionChecker = restified.autocommit(async t => {
    host = (await cluster.getScsiHosts({
      include: [{
        model: Host,
        where: {
          hostName: hostName
        }
      }],
      limit: 1,
      offset: 0,
      transaction: t
    }))[0];

    if (!host) {
      throw new except.NotFoundError(`host "${hostName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.iscsi.enableDiscoveryAuthentication({
        host: hostName,
        domain: domain,
        password: password,
        timeout: ClusterUpdater.ExtendedTimeoutValue
      });

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateScsiHosts(cluster, proxy, [host.Host], {isPartialUpdate: true});

      const gn = restified.autocommit(async t => {
        return await formatScsiHost(t, cluster, result.scsiHosts[0]);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function deleteScsiTarget(req, res) {
  const {
    clusterName: {value: clusterName},
    targetName: {value: targetName},
    remove: {value: {
      destroyData: destroyData = false
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  let scsiHost = null;

  const preconditionChecker = restified.autocommit(async t => {
    const [target] = await cluster.getScsiTargets({
      where: {
        name: targetName
      },
      include: [{
        model: ScsiHost,
        include: [{
          model: Host
        }]
      }],
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!target) {
      throw new except.NotFoundError(`iscsi target "${targetName}" not found in cluster "${clusterName}"`);
    }

    scsiHost = target.ScsiHost;

    if (!scsiHost || !scsiHost.Host) {
      throw new except.NotFoundError(`target "${targetName}" is missing in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        await proxy.iscsi.del(targetName, destroyData, {
          host: scsiHost.Host.hostName,
          timeout: ClusterUpdater.ExtendedTimeoutValue,
          usage: false
        });
      }
      catch (err) {
        if (ErrorFormatter.format(err).indexOf('target not found') < 0) {
          throw err;
        }
      }

      const gn = restified.autocommit(async t => {
        const [target] = await cluster.getScsiTargets({
          where: {
            name: targetName
          },
          limit: 1,
          offset: 0,
          transaction: t
        });

        if (!target) {
          throw new except.NotFoundError(`iscsi target "${targetName}" not found in cluster "${clusterName}"`);
        }

        await target.destroy({transaction: t});

        return {};
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function getScsiTarget(t, req, res) {
  const {
    clusterName: {value: clusterName},
    targetName: {value: targetName}
  } = req.swagger.params;

  const target = await ScsiTarget.findOne({
    where: {
      name: targetName
    },
    include: [{
      model: Cluster,
      where: {
        name: clusterName
      }
    }, {
      model: ScsiHost,
      include: [{
        model: Host
      }]
    }, {
      model: RbdImage
    }, {
      model: ScsiLun
    }],
    transaction: t
  });

  if (!target) {
    throw new except.NotFoundError(`iscsi target "${targetName}" not found in cluster "${clusterName}"`);
  }

  res.json(await formatScsiTarget(t, target.Cluster, target));
}

async function addScsiTarget(req, res) {
  const {
    clusterName: {value: clusterName},
    target: {value: {
      name: name,
      domain: domain,
      image: image,
      pool: pool,
      size: size,
      host: hostName
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  let host = null;

  const preconditionChecker = restified.autocommit(async t => {
    const [target] = await cluster.getScsiTargets({
      where: {
        name: name
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (target) {
      throw new except.ConflictError(`iscsi target "${name}" already exists for cluster "${clusterName}"`);
    }

    const [rbdImage] = await cluster.getRbdImages({
      where: {
        pool: pool,
        image: image
      },
      limit: 1,
      offset: 0,
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

    host = (await cluster.getScsiHosts({
      include: [{
        model: Host,
        where: {
          hostName: hostName
        }
      }],
      limit: 1,
      offset: 0,
      transaction: t
    }))[0];

    if (!host) {
      throw new except.NotFoundError(`host "${host}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      const actualTarget = await proxy.iscsi.add({
        name: name,
        host: hostName,
        domain: domain,
        image: image,
        pool: pool,
        size: size,
        usage: false,
        timeout: ClusterUpdater.ExtendedTimeoutValue
      });

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateScsiTargets(cluster, proxy, [host.Host], {
        targets: [name]
      });

      const gn = restified.autocommit(async t => {
        return await formatScsiTarget(t, cluster, result.targets[0]);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function getScsiHost(t, req, res) {
  const {
    clusterName: {value: clusterName},
    hostName: {value: hostName}
  } = req.swagger.params;

  const host = await ScsiHost.findOne({
    include: [{
      model: Cluster,
      where: {
        name: clusterName
      }
    }, {
      model: Host,
      where: {
        hostName: hostName
      },
      include: [{
        model: RpcType
      }]
    }]
  });

  if (!host) {
    throw new except.NotFoundError(`iscsi host "${hostName}" not found in cluster "${clusterName}"`);
  }

  res.json(await formatScsiHost(t, host.Cluster, host));
}

async function listScsiHosts(t, req, res) {
  const {
    clusterName: {value: clusterName},
    start: {value: start = req.swagger.params.start.schema.default},
    length: {value: length = req.swagger.params.length.schema.default}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    },
    transaction: t
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  const total = await cluster.countScsiHosts({transaction: t});

  const hosts = await cluster.getScsiHosts({
    include: [{
      model: Host,
      include: [{
        model: RpcType
      }]
    }],
    transaction: t,
    limit: length,
    offset: start
  });

  res.json({
    total: total,
    result: await Promise.all(hosts.map(host => formatScsiHost(t, cluster, host)))
  });
}

async function listScsiTargets(t, req, res) {
  const {
    clusterName: {value: clusterName},
    start: {value: start = req.swagger.params.start.schema.default},
    length: {value: length = req.swagger.params.length.schema.default}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    },
    transaction: t
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster "${clusterName}" not found in cluster "${clusterName}"`);
  }

  const total = await cluster.countScsiTargets({transaction: t});

  const targets = await cluster.getScsiTargets({
    include: [{
      model: ScsiLun
    }, {
      model: RbdImage
    }, {
      model: ScsiHost,
      include: [{
        model: Host
      }]
    }],
    limit: length,
    offset: start,
    transaction: t
  });

  res.json({
    total: total,
    result: await Promise.all(targets.map(target => formatScsiTarget(t, cluster, target)))
  });
}
