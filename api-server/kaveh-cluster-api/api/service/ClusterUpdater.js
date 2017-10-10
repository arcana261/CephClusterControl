"use strict";

const ClientLoop = require('../../../../lib/rpc/ClientLoop');
const Proxy = require('../../../../lib/proxy');
const {Cluster, Host, RpcType} = require('../../models');
const restified = require('../helpers/restified');
const HostStatus = require('../../api/const/HostStatus');

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
          await Host.update(this._createHostModel(actualHost), {
            where: {
              hostName: host.hostName
            },
            transaction: t
          });
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
    }
    finally {
      await client.stop();
    }
  }
}

module.exports = ClusterUpdater;
