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
    plugins: ['ceph, rbd', 'samba', 'iscsi', 'ntp', 'rgw', 'scp', 'updater'],
    db: '/var/lib/kaveh-cluster-ctrl/cluster.db'
  },

  iscsi: {
    backup_interval_seconds: 3600,
    keep_files: 336,
    path: '/usr/local/lib/kaveh-cluster-ctrl/targetcli-backup'
  }
};
