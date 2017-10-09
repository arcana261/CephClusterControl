"use strict";

module.exports = {
  development: {
    server: {
      port: 3500
    },
    database: {
      username: 'root',
      password: '1234',
      database: 'kluster',
      host: '127.0.0.1',
      port: 0,
      dialect: 'mysql'
    },
    redis: {
      host: '127.0.0.1',
      port: 6379
    },
    rpc: {
      rabbitmq: '127.0.0.1',
      username: 'guest',
      password: 'guest',
      heartbeat: 10,
      topic: 'kaveh_cluster_ctrl',
      timeout: 2000
    },
    ceph: {
      id: 'admin'
    }
  },
  test: {
    server: {
      port: 3500
    },
    database: {
      username: 'root',
      password: '1234',
      database: 'kluster',
      host: '127.0.0.1',
      port: 0,
      dialect: 'mysql'
    },
    redis: {
      host: '127.0.0.1',
      port: 6379
    },
    rpc: {
      rabbitmq: '127.0.0.1',
      username: 'guest',
      password: 'guest',
      heartbeat: 10,
      topic: 'kaveh_cluster_ctrl',
      timeout: 2000
    },
    ceph: {
      id: 'admin'
    }
  },
  production: {
    server: {
      port: 3500
    },
    database: {
      username: 'root',
      password: '1234',
      database: 'kluster',
      host: '127.0.0.1',
      port: 0,
      dialect: 'mysql'
    },
    redis: {
      host: '127.0.0.1',
      port: 6379
    },
    rpc: {
      rabbitmq: '127.0.0.1',
      username: 'guest',
      password: 'guest',
      heartbeat: 10,
      topic: 'kaveh_cluster_ctrl',
      timeout: 2000
    },
    ceph: {
      id: 'admin'
    }
  }
};
