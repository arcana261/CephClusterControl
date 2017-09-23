"use strict";

/*
docker pull rabbitmq:latest
docker run -td --restart=always --name rabbitmq --hostname rabbitmq -p 5671:5671 -p 5672:5672 -p 4369:4369 -p 25672:25672 rabbitmq:latest
 */

const env = process.env.NODE_ENV || 'production';
const config = require('./config/config')[env];

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
const RadosGatewayClient = require('./lib/rgw');
const Retry = require('./lib/utils/Retry');
const Condition = require('./lib/utils/Condition');
const EtcParser = require('./lib/utils/EtcParser');

const onRbdAutoMount = new Condition();

function ensureDirectory(p) {
  return MkDir.path(path.dirname(p));
}

async function main() {
  const settings = await EtcParser.read(config.etc, require('./config/defaultValues'));

  const yargs = require('yargs')
    .usage('$0 [ceph|rbd|samba]')
    .option('rabbit', {
      describe: 'RabbitMQ Hostname',
      default: settings.rpc.rabbitmq
    })
    .option('topic', {
      describe: 'RabbitMQ Topic used for IPC communication',
      default: settings.rpc.topic
    })
    .option('heartbeat', {
      describe: 'timeout in seconds for connection keep-alive',
      default: settings.rpc.heartbeat
    })
    .option('id', {
      describe: 'ceph/rbd user id to use (without client. part)',
      default: settings.ceph.id
    })
    .option('db', {
      describe: 'local LevelDB database to use',
      default: settings.agent.db
    })
    .help()
    .argv;

  const connectionString = `amqp://${yargs.rabbit}?heartbeat=${yargs.heartbeat}`;

  log.info(`ConnectionString = ${connectionString}`);
  log.info(`Topic = ${yargs.topic}`);

  await ensureDirectory(yargs.db);
  const db = new LevelDb(yargs.db);

  const server = new ServerLoop(connectionString, yargs.topic);
  await server.start();

  log.info('RPC Server is ready');

  let inits = [];
  const plugins = (yargs._ && yargs._.length > 0) ? yargs._ : settings.agent.plugins;

  if (plugins.indexOf('ceph') >= 0) {
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

  if (plugins.indexOf('rbd') >= 0) {
    inits.push(RbdClient.capable().then(async result => {
      if (result) {
        const client = new RbdClient({db: db});
        server.addHandler('rbd', client);

        await server.addType('rbd');

        for (const fmt of await RbdClient.supportedFormatts()) {
          server.addHandler(`rbd:${fmt}`, client);
          await server.addType(`rbd:${fmt}`);
        }

        await Retry.run(async () => {
          log.info('checking volumes to automount...');

          for (const mountPoint of (await client.automount()).mountPoints) {
            log.info(`auto-mount successful for ${mountPoint.image} on ${mountPoint.location}`);
          }

          onRbdAutoMount.resolve();
        }, 10000, 10, (err, retryCount) => {
          log.error('error occurred while trying to automount rbd volumes:');
          log.error(ErrorFormatter.format(err));

          if (retryCount >= 0) {
            log.error('automounting rbd volumes re-scheduled in 10 seconds');
          }
          else {
            log.error('giving up on automounting rbd volumes');
          }
        });
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

  if (plugins.indexOf('samba') >= 0) {
    inits.push(SambaClient.capable().then(async result => {
      if (result) {
        const client = new SambaClient(({db: db}));
        await onRbdAutoMount.wait();

        await Retry.run(async () => {
          log.info('restarting samba service after rbd volumes...');
          await client.postRbdMount();
        }, 10000, 10, (err, retryCount) => {
          log.error('error occurred while trying to restart samba service...');
          log.error(ErrorFormatter.format(err));

          if (retryCount >= 0) {
            log.error('re-starting samba service re-scheduled in 10 seconds');
          }
          else {
            log.error('giving up on restarting samba service');
          }
        });

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

  if (plugins.indexOf('iscsi') >= 0) {
    inits.push(IScsiClient.capable().then(async result => {
      if (result) {
        const client = new IScsiClient({db: db});
        await onRbdAutoMount.wait();

        await Retry.run(async () => {
          log.info('restarting iscsi service after rbd volumes...');
          await client.postRbdMount();
        }, 10000, 10, (err, retryCount) => {
          log.error('error occurred while trying to restart iscsi service...');
          log.error(ErrorFormatter.format(err));

          if (retryCount >= 0) {
            log.error('re-starting iscsi service re-scheduled in 10 seconds');
          }
          else {
            log.error('giving up on restarting iscsi service');
          }
        });

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

  if (plugins.indexOf('ntp') >= 0) {
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

  if (plugins.indexOf('rgw') >= 0) {
    inits.push(RadosGatewayClient.capable().then(async result => {
      if (result) {
        const client = new RadosGatewayClient({db: db});
        server.addHandler('rgw', client);

        await server.addType('rgw');
      }
      else {
        log.warn('Plugin: "rgw" requested but could not be enabled');
      }
    }).catch(err => {
      log.warn('Plugin: "rgw" is disabled. provide "rgw" in startup script to enable it');
      log.error(ErrorFormatter.format(err));
    }));
  }
  else {
    log.warn('Plugin "rgw" is disabled. provide "rgw" in startup script to enable it');
  }

  Promise.all(inits)
    .then(() => server.types.forEach(x => log.info(`Plugin Enabled: "${x}"`)))
    .catch(err => log.error(ErrorFormatter.format(err)));
}

main().catch(err => {
  console.log('[ERR :(]\n', ErrorFormatter.format(err));
  process.exit(-1);
});
