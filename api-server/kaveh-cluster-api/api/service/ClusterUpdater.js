"use strict";

const ClientLoop = require('../../../../lib/rpc/ClientLoop');
const Proxy = require('../../../../lib/proxy');
const {Cluster, Host} = require('../../models');

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

    try {
      const proxy = new Proxy(client);
      this._cancelationPoint.checkExceptionPoint();

      const actualHosts = await proxy.hosts();
      this._cancelationPoint.checkExceptionPoint();

      for (const actualHost of actualHosts) {
      }
    }
    finally {
      await client.stop();
    }
  }
}

module.exports = ClusterUpdater;
