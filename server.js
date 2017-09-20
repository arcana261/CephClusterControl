"use strict";

/*
docker pull rabbitmq:latest
docker run -td --restart=always --name rabbitmq --hostname rabbitmq -p 5671:5671 -p 5672:5672 -p 4369:4369 -p 25672:25672 rabbitmq:latest
 */

const ServerLoop = require('./lib/rpc/ServerLoop');
const CephClient = require('./lib/ceph');
const RbdClient = require('./lib/rbd');
const log = require('logging').default('server-main');
const path = require('path');
const MkDir = require('./lib/utils/MkDir');
const LevelDb = require('./lib/utils/LevelDb');
const ErrorFormatter = require('./lib/utils/ErrorFormatter');
const SambaClient = require('./lib/samba');
const IScsiClient = require('./lib/iscsi');
const NtpClient = require('./lib/ntp');

function ensureDirectory(p) {
  return MkDir.path(path.dirname(p));
}

const yargs = require('yargs')
  .usage('$0 [ceph|rbd|samba]')
  .option('rabbit', {
    describe: 'RabbitMQ Hostname',
    default: 'localhost'
  })
  .option('topic', {
    describe: 'RabbitMQ Topic used for IPC communication',
    default: 'kaveh_cluster_ctrl'
  })
  .option('heartbeat', {
    describe: 'timeout in seconds for connection keep-alive',
    default: 10
  })
  .option('id', {
    describe: 'ceph/rbd user id to use (without client. part)',
    default: 'admin'
  })
  .option('db', {
    describe: 'local LevelDB database to use',
    default: path.join(__dirname, 'data', 'cluster.db')
  })
  .help()
  .argv;

async function main() {
  const connectionString = `amqp://${yargs.rabbit}?heartbeat=${yargs.heartbeat}`;

  log.info(`ConnectionString = ${connectionString}`);
  log.info(`Topic = ${yargs.topic}`);

  await ensureDirectory(yargs.db);
  const db = new LevelDb(yargs.db);

  const server = new ServerLoop(connectionString, yargs.topic);
  await server.start();

  log.info('RPC Server is ready');

  let inits = [];

  if (yargs._.indexOf('ceph') >= 0) {
    inits.push(CephClient.capable().then(async result => {
      if (result) {
        server.addHandler('ceph', new CephClient({db: db}));

        await server.addType('ceph');
      }
      else {
        log.warn('Plugin: "ceph" requested but could not be enabled');
      }
    }).catch(err => {
      log.warn('Plugin: "ceph" requested but could not be enabled');
      log.error(ErrorFormatter.format(err));
    }));
  }
  else {
    log.warn('Plugin: "ceph" is disabled. provider "ceph" in startup script to enable it.');
  }

  if (yargs._.indexOf('rbd') >= 0) {
    inits.push(RbdClient.capable().then(async result => {
      if (result) {
        const client = new RbdClient({db: db});
        server.addHandler('rbd', client);

        await server.addType('rbd');

        for (const fmt of await RbdClient.supportedFormatts()) {
          server.addHandler(`rbd:${fmt}`, client);
          await server.addType(`rbd:${fmt}`);
        }

        log.info('checking volumes to automount...');

        for (const mountPoint of (await client.automount()).mountPoints) {
          log.info(`auto-mount successful for ${mountPoint.image} on ${mountPoint.target}`);
        }
      }
      else {
        log.warn('Plugin: "rbd" requested but could not be enabled');
      }
    }).catch(err => {
      log.warn('Plugin: "rbd" requested but could not be enabled');
      log.error(ErrorFormatter.format(err));
    }));
  }
  else {
    log.warn('Plugin: "rbd" is disabled. provide "rbd" in startup script to enable it.');
  }

  if (yargs._.indexOf('samba') >= 0) {
    inits.push(SambaClient.capable().then(async result => {
      if (result) {
        const client = new SambaClient(({db: db}));
        server.addHandler('samba', client);

        await server.addType('samba');
      }
      else {
        log.warn('Plugin: "samba" requested but could not be enabled');
      }
    }).catch(err => {
      log.warn('Plugin: "samba" requested but could not be enabled');
      log.error(ErrorFormatter.format(err));
    }));
  }
  else {
    log.warn('Plugin: "samba" is disabled. provide "samba" in startup script to enable it.');
  }

  if (yargs._.indexOf('iscsi') >= 0) {
    inits.push(IScsiClient.capable().then(async result => {
      if (result) {
        const client = new IScsiClient({db: db});
        server.addHandler('iscsi', client);

        await server.addType('iscsi');
      }
      else {
        log.warn('Plugin: "iscsi" requested but could not be enabled');
      }
    }).catch(err => {
      log.warn('Plugin: "iscsi" requested but could not be enabled');
      log.error(ErrorFormatter.format(err));
    }));
  }
  else {
    log.warn('Plugin: "iscsi" is disabled. provide "iscsi" in startup script to enable it.');
  }

  if (yargs._.indexOf('ntp') >= 0) {
    inits.push(NtpClient.capable().then(async result => {
      if (result) {
        const client = new NtpClient({db: db});
        server.addHandler('ntp', client);

        await server.addType('ntp');
      }
      else {
        log.warn('Plugin: "ntp" requested but could not be enabled');
      }
    }).catch(err => {
      log.warn('Plugin: "ntp" requested but could not be enabled');
      log.error(ErrorFormatter.format(err));
    }));
  }
  else {
    log.warn('Plugin: "ntp" is disabled. provide "ntp" in startup script to enable it');
  }

  Promise.all(inits)
    .then(() => server.types.forEach(x => log.info(`Plugin Enabled: "${x}"`)))
    .catch(err => log.error(ErrorFormatter.format(err)));
}

main().catch(err => {
  console.log('[ERR :(]\n', ErrorFormatter.format(err));
  process.exit(-1);
});
