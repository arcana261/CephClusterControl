"use strict";

const ClientLoop = require('../../../../lib/rpc/ClientLoop');
const Proxy = require('../../../../lib/proxy');
const {Cluster, Host, RpcType, RbdImage} = require('../../models');
const restified = require('../helpers/restified');
const HostStatus = require('../../api/const/HostStatus');
const RbdImageStatus = require('../../api/const/RbdImageStatus');
const ImageNameParser = require('../../../../lib/utils/ImageNameParser');

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
      capacity = actualImage.diskSize;
      used = actualImage.diskUsed;
    }

    if (mountPoint) {
      capacity = mountPoint.diskSize;
      used = mountPoint.diskUsed;
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
    }
    finally {
      await client.stop();
    }
  }
}

module.exports = ClusterUpdater;
