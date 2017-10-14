"use strict";

const ClientLoop = require('../../../../lib/rpc/ClientLoop');
const Proxy = require('../../../../lib/proxy');
const restified = require('../helpers/restified');
const HostStatus = require('../../api/const/HostStatus');
const RbdImageStatus = require('../../api/const/RbdImageStatus');
const ImageNameParser = require('../../../../lib/utils/ImageNameParser');
const SambaAuthUtils = require('../../../../lib/utils/SambaAuthUtils');
const SambaStatus = require('../../api/const/SambaStatus');

const {
  Cluster,
  Host, RpcType,
  RbdImage,
  SambaUser, SambaAcl, SambaShare
} = require('../../models');

class ClusterUpdater {
  /**
   * @param {string} clusterName
   * @param {CancelationPoint} cancelationPoint
   */
  constructor(clusterName, cancelationPoint) {
    this._clusterName = clusterName;
    this._cancelationPoint = cancelationPoint;
  }

  /**
   * @param {SambaShare} actualShare
   * @returns {SambaShareModel}
   * @private
   */
  _createSambaShareModel(actualShare) {
    return {
      name: actualShare.name,
      comment: actualShare.comment,
      browsable: actualShare.browsable,
      guest: SambaAuthUtils.stringifyPermission(actualShare.guest),
      status: SambaStatus.up
    };
  }

  /**
   * @param {ClusterModel} cluster
   * @param {Proxy} proxy
   * @returns {Promise.<void>}
   * @private
   */
  async _updateSambaShares(cluster, proxy) {
    const actualShares = await proxy.samba.ls();
    this._cancelationPoint.checkExceptionPoint();

    const fn = restified.autocommit(async t => {
      const shares = await cluster.getSambaShares({transaction: t});

      for (const actualShare of actualShares) {
        let share = shares.filter(x => x.name === actualShare.name)[0];

        if (!share) {
          share = await SambaShare.create(this._createSambaShareModel(actualShare), {transaction: t});
          await share.setCluster(cluster, {transaction: t});
        }
        else {
          Object.assign(share, this._createSambaShareModel(actualShare));
          await share.save({transaction: t});
        }

        let host = await share.getHost({transaction: t});

        if (!host || host.hostName !== actualShare.host) {
          host = (await cluster.getHosts({
            where: {
              hostName: actualShare.host
            },
            limit: 1,
            offset: 0,
            transaction: t
          }))[0];

          if (host) {
            await share.setHost(host, {transaction: t});
          }
        }

        let rbdImage = await share.getRbdImage({transaction: t});

        if (!rbdImage || rbdImage.pool !== actualShare.pool || rbdImage.image !== actualShare.image) {
          rbdImage = (await cluster.getRbdImages({
            where: {
              pool: actualShare.pool,
              image: actualShare.image
            },
            limit: 1,
            offset: 0,
            transaction: t
          }))[0];

          if (rbdImage) {
            await share.setRbdImage(rbdImage, {transaction: t});
          }
        }

        if (host) {
          const acls = await share.getSambaAcls({
            include: [{
              model: SambaUser
            }],
            transaction: t
          });

          for (const [userName, actualAcl] of Object.entries(actualShare.acl)) {
            let acl = acls.filter(x => x.SambaUser && x.SambaUser.userName === userName)[0];

            let user = (await host.getSambaUsers({
              where: {
                userName: userName
              },
              transaction: t,
              limit: 1,
              offset: 0
            }))[0];

            if (!user) {
              user = await SambaUser.create({
                userName: userName,
                password: actualAcl.password || ''
              }, {transaction: t});

              await host.addSambaUser(user, {transaction: t});
            }
            else {
              Object.assign(user, {password: actualAcl.password || ''});
              await user.save({transaction: t});
            }

            if (!acl) {
              acl = await SambaAcl.create({
                permission: SambaAuthUtils.stringifyPermission(actualAcl.permission)
              }, {transaction: t});

              await acl.setSambaUser(user, {transaction: t});
              await acl.setSambaShare(share, {transaction: t});
            }
            else {
              Object.assign(acl, {
                permission: SambaAuthUtils.stringifyPermission(actualAcl.permission)
              });

              await acl.save({transaction: t});
            }
          }

          const missingAcls = acls.filter(x => !(x.SambaUser.userName in actualShare.acl));

          for (const missingAcl of missingAcls) {
            await missingAcl.destroy({transaction: t});
          }
        }
      }

      const missingShares = shares.filter(x => !actualShares.some(y => x.name === y.name));

      for (const missingShare of missingShares) {
        Object.assign(missingShare, {
          status: SambaStatus.missing
        });

        await missingShare.save({transaction: t});
      }
    });

    await fn();
  }

  /**
   * @param {WorkerInfoResponseItem} actualHost
   * @returns {HostModel}
   * @private
   */
  _createHostModel(actualHost) {
    return {
      hostName: actualHost.hostname,
      version: actualHost.version,
      status: HostStatus.up,
      distro_centos: actualHost.distro.centos,
      distro_ubuntu: actualHost.distro.ubuntu,
      distro_version: actualHost.distro.version,
      ipList: JSON.stringify({list: actualHost.ip})
    };
  }

  /**
   * @param {ParsedImageName} name
   * @param {RbdImageInfo} actualImage
   * @param {RbdMountPoint|null} mountPoint
   * @param {RbdImageModel|null} prevModel
   * @returns {RbdImageModel}
   * @private
   */
  _createRbdImageModel(name, actualImage, mountPoint, prevModel) {
    let capacity = 0;
    let used = 0;

    if (prevModel) {
      capacity = prevModel.capacity;
      used = prevModel.used;
    }

    if (actualImage) {
      capacity = Math.round(actualImage.diskSize);
      used = Math.round(actualImage.diskUsed);
    }

    if (mountPoint) {
      capacity = Math.round(mountPoint.diskSize);
      used = Math.round(mountPoint.diskUsed);
    }

    return {
      pool: name.pool,
      image: name.image,
      capacity: capacity,
      used: used,
      fileSystem: mountPoint ? mountPoint.fileSystem : (actualImage ? actualImage.fileSystem : null),
      isMounted: !!mountPoint,
      status: actualImage ? RbdImageStatus.up : RbdImageStatus.failed,
      mountPoint_location: mountPoint ? mountPoint.mountPoint : null,
      mountPoint_rbdId: mountPoint ? mountPoint.rbdId : null,
      mountPoint_device: mountPoint ? mountPoint.device : null,
      mountPoint_readOnly: mountPoint ? mountPoint.readOnly : null
    };
  }

  /**
   * @param {ClusterModel} cluster
   * @param {Proxy} proxy
   * @returns {Promise.<void>}
   * @private
   */
  async _updateHosts(cluster, proxy) {
    const actualHosts = await proxy.hosts();
    this._cancelationPoint.checkExceptionPoint();

    const fn = restified.autocommit(async t => {
      const hosts = await cluster.getHosts({transaction: t});
      const rpcTypeCache = {};

      for (const actualHost of actualHosts) {
        let host = hosts.filter(x => x.hostName === actualHost.hostname)[0];

        if (!host) {
          host = await Host.create(this._createHostModel(actualHost), {transaction: t});
          await cluster.addHost(host, {transaction: t});
        }
        else {
          Object.assign(host, this._createHostModel(actualHost));
          await host.save({transaction: t});
        }

        const types = await Promise.all(actualHost.types.map(async type => {
          if (type in rpcTypeCache) {
            return rpcTypeCache[type];
          }

          const [result] = (await RpcType.findOrCreate({
            where: {
              name: type
            },
            defaults: {
              name: type
            },
            transaction: t
          }));

          rpcTypeCache[type] = result;
          return result;
        }));

        await host.setRpcTypes(types, {transaction: t});
      }

      const missingHosts = hosts.filter(x => !actualHosts.some(y => x.hostName === y.hostname));

      for (const host of missingHosts) {
        await Host.update({
          status: HostStatus.down
        }, {
          where: {
            hostName: host.hostName
          },
          transaction: t
        });
      }
    });

    await fn();
  }

  /**
   * @param {ClusterModel} cluster
   * @param {Proxy} proxy
   * @returns {Promise.<void>}
   * @private
   */
  async _updateRbdImages(cluster, proxy) {
    const actualMountPoints = await proxy.rbd.getMapped();
    this._cancelationPoint.checkExceptionPoint();

    const actualImages = await Promise.all((await proxy.rbd.ls({pool: '*'})).map(async name => {
      try {
        const parsedName = ImageNameParser.parse(name);
        const mountPoint = actualMountPoints.filter(x => x.image === parsedName.fullName)[0];
        const targetHost = mountPoint ? mountPoint.hostname : null;

        return [name, await proxy.rbd.info({image: name, timeout: -1, host: targetHost})];
      }
      catch (err) {
        return [name, null];
      }
    }));
    this._cancelationPoint.checkExceptionPoint();


    const fn = restified.autocommit(async t => {
      const images = await cluster.getRbdImages({transaction: t});

      for (const [imageName, actualImage] of actualImages) {
        const name = ImageNameParser.parse(actualImage ? actualImage.image : imageName);
        let image = images.filter(x => x.pool === name.pool && x.image === name.image)[0];
        const mountPoint = actualMountPoints.filter(x => x.image === name.fullName)[0];

        if (!image) {
          image = await RbdImage.create(this._createRbdImageModel(name, actualImage, mountPoint, null), {transaction: t});
          await cluster.addRbdImage(image, {transaction: t});
        }
        else {
          await RbdImage.update(this._createRbdImageModel(name, actualImage, mountPoint, image), {
            where: {
              pool: image.pool,
              image: image.image
            },
            transaction: t
          });
        }

        let host = await image.getHost();

        if (host && !mountPoint) {
          await image.setHost(null, {transaction: t});
        }
        else if (!host && mountPoint) {
          host = await Host.findOne({
            where: {
              hostName: mountPoint.hostname
            },
            include: [{
              model: Cluster,
              where: {
                name: cluster.name
              }
            }],
            transaction: t
          });

          if (host) {
            await host.addRbdImage(image, {transaction: t});
          }
        }
      }

      const missingImages = images.filter(x => {
        const name = ImageNameParser.parse(x.image, x.pool);

        return !actualImages.some(([imageName, actualImage]) =>
          ImageNameParser.parse(actualImage ? actualImage.image : imageName).fullName === name.fullName);
      });

      for (const missingImage of missingImages) {
        missingImage.status = RbdImageStatus.missing;
        await missingImage.save({transaction: t});
      }
    });

    await fn();
  }

  /**
   * @returns {string}
   */
  get clusterName() {
    return this._clusterName;
  }

  async run() {
    this._cancelationPoint.checkExceptionPoint();

    const cluster = await Cluster.findOne({
      where: {
        name: this._clusterName
      },
      include: [{
        model: Host
      }]
    });

    if (!cluster) {
      throw new Error(`specified cluster not found "${this._clusterName}"`);
    }

    const connectionString =
      `amqp://${cluster.brokerUserName}:${cluster.brokerPassword}@${cluster.brokerHost}?heartbeat=${cluster.brokerHeartBeat}`;
    const client = new ClientLoop(connectionString, cluster.brokerTopic, cluster.brokerTimeout);
    await client.start();

    try {
      const proxy = new Proxy(client);
      this._cancelationPoint.checkExceptionPoint();

      await this._updateHosts(cluster, proxy);
      this._cancelationPoint.checkExceptionPoint();

      await this._updateRbdImages(cluster, proxy);
      this._cancelationPoint.checkExceptionPoint();

      await this._updateSambaShares(cluster, proxy);
      this._cancelationPoint.checkExceptionPoint();
    }
    finally {
      await client.stop();
    }
  }
}

module.exports = ClusterUpdater;
