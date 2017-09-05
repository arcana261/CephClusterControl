"use strict";

const ServerLoop = require('./lib/rpc/ServerLoop');
const CephClient = require('./lib/ceph');
const RbdClient = require('./lib/rbd');
const log = require('logging').default('server-main');
const path = require('path');
const mkdirp = require('mkdirp');
const LevelDb = require('./lib/utils/LevelDb');
const ErrorFormatter = require('./lib/utils/ErrorFormatter');

function ensureDirectory(p) {
  return new Promise((resolve, reject) => mkdirp(path.dirname(p), err => {
    if (err) {
      reject(err);
    }
    else {
      resolve();
    }
  }));
}

const yargs = require('yargs')
  .usage('$0 [ceph|rbd]')
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
        server.addHandler('rbd', new RbdClient({db: db}));

        await server.addType('rbd');

        for (const fmt of await RbdClient.supportedFormatts()) {
          await server.addType(`rbd:${fmt}`);
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

  Promise.all(inits)
    .then(() => server.types.forEach(x => log.info(`Plugin Enabled: "${x}"`)))
    .catch(err => log.error(ErrorFormatter.format(err)));
}

main().catch(err => {
  console.log('[ERR :(]\n', ErrorFormatter.format(err));
  process.exit(-1);
});
