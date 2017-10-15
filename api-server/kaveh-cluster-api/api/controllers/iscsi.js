"use strict";

const restified = require('../helpers/restified');
const {Cluster, ScsiLun, RbdImage, ScsiHost, Host} = require('../../models');
const except = require('../helpers/except');
const IScsiUtils = require('../../../../lib/utils/IScsiUtils');

module.exports = restified.make({
  /**
   * GET /cluster/{clusterName}/iscsi
   */
  listScsiTargets: listScsiTargets
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
