"use strict";

const path = require('path');

module.exports = {
  rpc: {
    rabbitmq: 'localhost',
    heartbeat: 10,
    topic: 'kaveh_cluster_ctrl',
    timeout: 2000,
    username: 'guest',
    password: 'guest'
  },

  ceph: {
    id: 'admin'
  },

  agent: {
    plugins: ['ceph, rbd', 'samba', 'iscsi', 'ntp', 'rgw'],
    db: path.join(__dirname, '../data', 'cluster.db')
  }
};
