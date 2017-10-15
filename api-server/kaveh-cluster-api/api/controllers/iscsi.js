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
  extendScsiTargetCapacity: extendScsiTargetCapacity
});

/**
 * @param {*} t
 * @param {ClusterModel} cluster
 * @param {ScsiTargetModel} target
 * @returns {Promise.<*>}
 */
async function formatScsiTarget(t, cluster, target) {
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
    status: target.status
  };
}

/**
 * @param {*} t
 * @param {ClusterModel} cluster
 * @param {ScsiHostModel} scsiHost
 * @returns {Promise.<*>}
 */
async function formatScsiHost(t, cluster, scsiHost) {
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
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      const actualTarget = await proxy.iscsi.extend(targetName, size);

      const info = await Retry.run(async () => {
        return await proxy.rbd.info({
          image: rbdImage.image,
          pool: rbdImage.pool,
          host: scsiHost.Host.hostName,
          timeout: 10000
        });
      }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

      const gn = restified.make(async t => {
        Object.assign(rbdImage, {
          capacity: Math.round(info.diskSize || rbdImage.capacity),
          used: Math.round(info.diskUsed || rbdImage.used)
        });

        await rbdImage.save({transaction: t});

        const [target] = await cluster.getScsiTargets({
          where: {
            name: targetName
          },
          include: [{
            model: RbdImage
          }, {
            model: ScsiLun
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

        return await formatScsiTarget(t, cluster, target);
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

  const preconditionChecker = restified.autocommit(async t => {
    const [target] = await cluster.getScsiTargets({
      where: {
        name: targetName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!target) {
      throw new except.NotFoundError(`target "${targetName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      const actualTarget = await proxy.iscsi.disableAuthentication(targetName);

      const gn = restified.autocommit(async t => {
        const [target] = await cluster.getScsiTargets({
          where: {
            name: targetName
          },
          include: [{
            model: RbdImage
          }, {
            model: ScsiLun
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

        if (actualTarget.authentication) {
          Object.assign(target, {
            requiresAuth: true,
            userName: actualTarget.authentication.userId,
            password: actualTarget.authentication.password
          });
        }
        else {
          Object.assign(target, {
            requiresAuth: false,
            userName: null,
            password: null
          });
        }

        await target.save({transaction: t});

        return await formatScsiTarget(t, cluster, target);
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

  const preconditionChecker = restified.autocommit(async t => {
    const [target] = await cluster.getScsiTargets({
      where: {
        name: targetName
      },
      limit: 1,
      offset: 0,
      transaction: t
    });

    if (!target) {
      throw new except.NotFoundError(`target "${targetName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      const actualTarget = await proxy.iscsi.enableAuthentication(targetName, password);

      const gn = restified.autocommit(async t => {
        const [target] = await cluster.getScsiTargets({
          where: {
            name: targetName
          },
          include: [{
            model: RbdImage
          }, {
            model: ScsiLun
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

        if (actualTarget.authentication) {
          Object.assign(target, {
            requiresAuth: true,
            userName: actualTarget.authentication.userId,
            password: actualTarget.authentication.password
          });
        }
        else {
          Object.assign(target, {
            requiresAuth: false,
            userName: null,
            password: null
          });
        }

        await target.save({transaction: t});

        return await formatScsiTarget(t, cluster, target);
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

  const preconditionChecker = restified.autocommit(async t => {
    const [host] = await cluster.getScsiHosts({
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

    if (!host) {
      throw new except.NotFoundError(`host "${hostName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.iscsi.disableDiscoveryAuthentication(hostName);

      const [actualHost] = (await proxy.iscsi.hosts()).filter(x => x.hostname === hostName);

      if (!actualHost) {
        throw new except.NotFoundError(`host "${hostName}" not found in cluster "${clusterName}"`);
      }

      const gn = restified.autocommit(async t => {
        const [host] = await cluster.getScsiHosts({
          include: [{
            model: Host,
            where: {
              hostName: hostName
            },
            include: [{
              model: RpcType
            }]
          }],
          limit: 1,
          offset: 0,
          transaction: t
        });

        if (!host) {
          throw new except.NotFoundError(`host "${hostName}" not found in cluster "${clusterName}"`);
        }

        if (actualHost.discovery) {
          Object.assign(host, {
            requiresAuth: true,
            userName: actualHost.discovery.userId,
            password: actualHost.discovery.password
          });
        }
        else {
          Object.assign(host, {
            requiresAuth: false,
            userName: null,
            password: null
          });
        }

        await host.save({transaction: t});

        return await formatScsiHost(t, cluster, host);
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

  const preconditionChecker = restified.autocommit(async t => {
    const [host] = await cluster.getScsiHosts({
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
        password: password
      });

      const [actualHost] = (await proxy.iscsi.hosts()).filter(x => x.hostname === hostName);

      if (!actualHost) {
        throw new except.NotFoundError(`host "${hostName}" not found in cluster "${clusterName}"`);
      }

      const gn = restified.autocommit(async t => {
        const [host] = await cluster.getScsiHosts({
          include: [{
            model: Host,
            where: {
              hostName: hostName
            },
            include: [{
              model: RpcType
            }]
          }],
          limit: 1,
          offset: 0,
          transaction: t
        });

        if (!host) {
          throw new except.NotFoundError(`host "${hostName}" not found in cluster "${clusterName}"`);
        }

        if (actualHost.discovery) {
          Object.assign(host, {
            requiresAuth: true,
            userName: actualHost.discovery.userId,
            password: actualHost.discovery.password
          });
        }
        else {
          Object.assign(host, {
            requiresAuth: false,
            userName: null,
            password: null
          });
        }

        await host.save({transaction: t});

        return await formatScsiHost(t, cluster, host);
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

  const preconditionChecker = restified.autocommit(async t => {
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
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.iscsi.del(targetName, false);

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

  const preconditionChecker = restified.make(async t => {
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

    const [host] = await cluster.getScsiHosts({
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
        size: size
      });

      const gn = restified.autocommit(async t => {
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

        const [host] = await cluster.getScsiHosts({
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

        if (!host) {
          throw new except.NotFoundError(`host "${host}" not found in cluster "${clusterName}"`);
        }

        const target = await ScsiTarget.create({
          iqn: actualTarget.stringifiedIqn,
          requiresAuth: !!actualTarget.authentication,
          userName: actualTarget.authentication ? actualTarget.authentication.userId : null,
          password: actualTarget.authentication ? actualTarget.authentication.password : null,
          status: ScsiTargetStatus.up
        }, {transaction: t});

        await target.setCluster(cluster, {transaction: t});
        await target.setRbdImage(rbdImage, {transaction: t});
        await target.setScsiHost(host, {transaction: t});

        if (actualTarget.luns) {
          for (let i = 0; i < actualTarget.luns.sizes.length; i++) {
            const newLun = await ScsiLun.create({
              size: Math.round(actualTarget.luns.sizes[i]),
              status: ScsiLunStatus.up
            });

            await newLun.setScsiTarget(target, {transaction: t});
          }
        }

        return await formatScsiTarget(t, cluster, target);
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
    result: await Promise.all(targets.map(target => formatScsiTarget(t, cluster, target)))
  });
}
