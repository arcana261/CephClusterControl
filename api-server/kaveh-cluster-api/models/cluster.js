"use strict";

const ClientLoop = require('../../../lib/rpc/ClientLoop');
const Proxy = require('../../../lib/proxy');

/**
 * @typedef {object} ClusterModel
 * @property {string} name
 * @property {string} brokerHost
 * @property {string} brokerUserName
 * @property {string} brokerPassword
 * @property {number} brokerHeartBeat
 * @property {string} brokerTopic
 * @property {number} brokerTimeout
 */

module.exports = (sequelize, DataTypes) => {
  const Cluster = sequelize.define('Cluster', {
    name: DataTypes.STRING,
    brokerHost: DataTypes.STRING,
    brokerUserName: DataTypes.STRING,
    brokerPassword: DataTypes.STRING,
    brokerHeartBeat: DataTypes.INTEGER,
    brokerTopic: DataTypes.STRING,
    brokerTimeout: DataTypes.INTEGER
  }, {
    classMethods: {
    }
  });

  Cluster.associate = function({Host, RbdImage, SambaShare}) {
    Cluster.hasMany(Host);
    Cluster.hasMany(RbdImage);
    Cluster.hasMany(SambaShare);
  };

  Cluster.prototype.autoclose = function(fn) {
    const self = this;

    return async function() {
      const args = Array.from(arguments);
      const connectionString = `amqp://${self.brokerUserName}:${self.brokerPassword}` +
        `@${self.brokerHost}?heartbeat=${self.brokerHeartBeat}`;
      const client = new ClientLoop(connectionString, self.brokerTopic, self.brokerTimeout);
      await client.start();

      try {
        const proxy = new Proxy(client);
        await fn.apply(this, [proxy].concat(args));
      }
      finally {
        await client.stop();
      }
    };
  };

  return Cluster;
};