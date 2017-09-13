"use strict";

const ClientLoop = require('./lib/rpc/ClientLoop');
const Proxy = require('./lib/proxy');
const UTCClock = require('utc-clock');
const AgeReporter = require('./lib/utils/AgeReporter');
const TablePrinter = require('./lib/utils/TablePrinter');
const SizeParser = require('./lib/utils/SizeParser');
const CephAuthUtils = require('./lib/utils/CephAuthUtils');

/**
 * @param {{rabbit: String, heartbeat: Number, timeout: Number}} argv
 * @returns {ClientLoop}
 */
function makeClient(argv) {
  return new ClientLoop(`amqp://${argv.rabbit}?heartbeat=${argv.heartbeat}`, argv.topic, {timeout: argv.timeout});
}

/**
 * @callback CommandCallback
 * @param {*} argv
 * @param {Proxy} proxy
 */

/**
 * @param {CommandCallback} prg
 * @returns {Function}
 */
function command(prg) {
  return async function(argv) {
    try {
      const client = makeClient(argv);
      const proxy = new Proxy(client);
      await client.start();

      await prg(argv, proxy);

      process.exit(0);
    }
    catch (err) {
      console.error(err);
      process.exit(-1);
    }
  }
}

/**
 * @param {Object.<String, CommandCallback>} opts
 * @returns {Function}
 */
function subcommand(opts) {
  return command(async (argv, proxy) => {
    for (let sub of Object.keys(opts)) {
      if (argv[sub] === sub) {
        const result = await opts[sub](argv, proxy);

        if (result === false) {
          yargs.showHelp('log');
          process.exit(-1);
        }

        return;
      }
    }

    yargs.showHelp('log');
    process.exit(-1);
  });
}

function patience() {
  console.log('This may take minutes to complete');
  console.log('Please be patient...');
  console.log();
}

/**
 * @param {*} argv
 * @returns {CephCaps|null}
 */
function parseCapsArgv(argv) {
  if (!argv.args || (argv.args.length % 2) !== 0) {
    return null;
  }

  const required = {
    mon: [],
    osd: [],
    mds: []
  };

  for (let i = 0; i < argv.args.length; i += 2) {
    required[argv.args[i]] = required[argv.args[i]].concat(CephAuthUtils.parseEntityCaps(argv.args[i + 1]));
  }

  return required;
}

const yargs = require('yargs')
  .command('ceph <lspool|lshost|ls-auth|chk-auth|add-auth|get-auth|save-auth|del-auth|get-quota|set-quota|create-pool|del-pool|df> [client] [args..]', 'view information about ceph cluster', {
    'yes-i-really-really-mean-it': {
      describe: 'provide it for deleting pools',
      default: false,
      requiresArg: false
    }
  }, subcommand({
    lspool: async (argv, proxy) => {
      console.log((await proxy.ceph.pool.ls()).join(', '));
    },

    lshost: async (argv, proxy) => {
      for (let host of (await proxy.ceph.hosts())) {
        console.log(`${host.hostname}@${host.version} [${host.types.join(', ')}]`)
      }
    },

    'ls-auth': async (argv, proxy) => {
      for (const [client, cephAuthEntry] of Object.entries(await proxy.ceph.auth.ls())) {
        console.log(client);

        if (cephAuthEntry.key) {
          console.log(`\tkey: ${cephAuthEntry.key}`);
        }

        for (const [entity, entityCaps] of Object.entries(cephAuthEntry.caps)) {
          if (entityCaps.length > 0) {
            console.log(`\t[${entity}]: ${CephAuthUtils.stringifyEntityCaps(entityCaps)}`);
          }
        }
      }
    },

    'chk-auth': async (argv, proxy) => {
      if (!argv.client) {
        return false;
      }

      const required = parseCapsArgv(argv);

      if (required === null) {
        return false;
      }

      if (!(await proxy.ceph.auth.checkPermission(argv.client, required))) {
        console.log('denied');
      }
      else {
        console.log('permitted');
      }
    },

    'add-auth': async (argv, proxy) => {
      if (!argv.client) {
        return false;
      }

      const required = parseCapsArgv(argv);

      if (required === null) {
        return false;
      }

      await proxy.ceph.auth.add(argv.client, required);
    },

    'get-auth': async (argv, proxy) => {
      if (!argv.client) {
        return false;
      }

      console.log(await proxy.ceph.auth.get(argv.client));
    },

    'del-auth': async (argv, proxy) => {
      if (!argv.client) {
        return false;
      }

      await proxy.ceph.auth.del(argv.client);
    },

    'save-auth': async (argv, proxy) => {
      if (!argv.client) {
        return false;
      }

      console.log(await proxy.ceph.auth.save(argv.client));
    },

    'get-quota': async (argv, proxy) => {
      if (!argv.client) {
        return false;
      }

      const quota = await proxy.ceph.pool.getQuota(argv.client);

      if (quota === null) {
        console.log('N/A');
      }
      else {
        console.log(SizeParser.stringify(quota));
      }
    },

    'set-quota': async (argv, proxy) => {
      if (!argv.client || argv.args.length !== 1) {
        return false;
      }

      await proxy.ceph.pool.setQuota(argv.client, SizeParser.parseMegabyte(argv.args[0]));
    },

    'create-pool': async (argv, proxy) => {
      if (!argv.client || argv.args.length !== 2) {
        return false;
      }

      await proxy.ceph.pool.create(argv.client, parseInt(argv.args[0]), parseInt(argv.args[1]));
    },

    'del-pool': async (argv, proxy) => {
      if (!argv.client || argv.args.length !== 1 || argv.args[0] !== argv.client || !argv['yes-i-really-really-mean-it']) {
        return false;
      }

      await proxy.ceph.pool.del(argv.client);
    },

    df: async (argv, proxy) => {
      const result = await proxy.ceph.pool.df();

      TablePrinter.print(
        Object.entries(result)
          .sort(([leftName, leftData], [rightName, rightData]) =>
            rightData.used - leftData.used),
        [{key: 'Pool', value: ([name, data]) => name},
        {key: 'Used', value: ([name, data]) => SizeParser.stringify(data.used)},
        {key: 'Objects', value: ([name, data]) => data.objects}]);
    }
  }))
  .command('rbd <ls|lshost|du|info|create|showmapped|mount|umount|automount|rm|extend> [image] [location]', 'view information about rbd images', {
    pool: {
      describe: 'RBD pool, default is any pool "*"',
      default: '*',
      requiresArg: true
    },
    id: {
      describe: 'RBD keyring (without client. part)',
      default: 'admin',
      requiresArg: true
    },
    refresh: {
      describe: 'force refresh values e.g. disk usage',
      default: false,
      requiresArg: false
    },
    format: {
      describe: 'format of new rbd image to create. supported formatts are (' +
      'bfs, cramfs, ext2, ext3, ext4, ext4dev, fat, minix, msdos, ntfs, vfat, xfs)',
      default: 'xfs',
      requiresArg: true
    },
    size: {
      describe: 'size of new RBD image to create. e.g. 100MB',
      default: 0,
      requiresArg: true
    },
    'format-options': {
      describe: 'additional arguments to pass to mkfs',
      default: '',
      requiresArg: false
    },
    host: {
      describe: 'send command to specific host, e.g. used in mapping and mounting',
      default: '*',
      requiresArg: true
    },
    'read-only': {
      describe: 'mount target image as readonly',
      default: false,
      requiresArg: false
    },
    permanent: {
      describe: 'mount target image in designated host permanently during reboots',
      default: false,
      requiresArg: false
    }
  }, subcommand({
    ls: async (argv, proxy) => {
      (await proxy.rbd.ls({pool: argv.pool, id: argv.id})).forEach(x => console.log(x));
    },

    lshost: async (argv, proxy) => {
      for (let host of (await proxy.rbd.hosts())) {
        console.log(`${host.hostname}@${host.version} [${host.types.join(', ')}]`)
      }
    },

    du: async (argv, proxy) => {
      if (!argv.image) {
        return false;
      }

      let result = [];

      if (!argv.refresh) {
        result = await proxy.rbd.lastKnownDiskUsage({image: argv.image, pool: argv.pool, id: argv.id});
      }
      else {
        patience();
        result = await proxy.rbd.updateDiskUsage({image: argv.image, pool: argv.pool, id: argv.id});
      }

      if (result.length < 1) {
        console.log('WARN: no data available, supply --refresh to force calculation');
      }
      else {
        result.sort((x, y) => x.timestamp - y.timestamp);

        TablePrinter.print(result, [{key: 'Agent', value: x => `${x.hostname}@${x.instanceId}`},
          {key: 'Provisioned', value: x => SizeParser.stringify(x.provisioned)},
          {key: 'Used', value: x => SizeParser.stringify(x.used)},
          {key: 'Query Age', value: x => `${AgeReporter.format(x.timestamp, (new UTCClock()).now.ms())}`}]);
      }
    },

    info: async (argv, proxy) => {
      if (!argv.image) {
        return false;
      }

      const result = await proxy.rbd.info({image: argv.image, pool: argv.pool, id: argv.id});

      console.log(`rbd image '${result.image}':`);
      console.log(`\tsize ${SizeParser.stringify(result.size)} in ${result.objectCount} objects`);
      console.log(`\torder ${result.order} (${SizeParser.stringify(result.objectSize / 1024)} objects)`);
      console.log(`\tblock_name_prefix: ${result.blockNamePrefix}`);
      console.log(`\tformat: ${result.format}`);
      console.log(`\tfeatures: ${result.features.join(', ')}`);
      console.log(`\tflags: ${result.flags.join(', ')}`);
      console.log(`\tused: ${result.diskUsed ? SizeParser.stringify(result.diskUsed) : ''}`);
      console.log(`\tfileSystem: ${result.fileSystem || ''}`);
    },

    create: async (argv, proxy) => {
      if (!argv.image) {
        return false;
      }

      if (!argv.size) {
        return false;
      }

      patience();

      const name = await proxy.rbd.create({
        image: argv.image,
        pool: argv.pool,
        format: argv.format,
        formatOptions: argv.formatOptions,
        id: argv.id,
        size: SizeParser.parseMegabyte(argv.size)
      });

      console.log(`created image: ${name}`);
    },

    showmapped: async (argv, proxy) => {
      patience();

      const result = await proxy.rbd.getMapped({host: argv.host, id: argv.id});

      TablePrinter.print(result, [{key: 'Host', value: x => `${x.hostname}@${x.instanceId}`},
        {key: 'Image', value: x => x.image}, {key: 'Id', value: x => `${x.rbdId}`},
        {key: 'Snap', value: x => x.snap || ''}, {key: 'Device', value: x => x.device},
        {key: 'Size', value: x => (x.diskSize && SizeParser.stringify(x.diskSize)) || ''},
        {key: 'Used', value: x => (x.diskUsed && SizeParser.stringify(x.diskUsed)) || ''},
        {key: 'MountPoint', value: x => x.mountPoint || ''},
        {key: 'ReadOnly', value: x => x.readOnly ? 'RO' : 'RW'},
        {key: 'FileSystem', value: x => x.fileSystem || ''}]);
    },

    mount: async (argv, proxy) => {
      if (!argv.image) {
        return false;
      }

      patience();

      const result = await proxy.rbd.mount({
        image: argv.image,
        host: argv.host,
        pool: argv.pool,
        target: argv.location,
        fileSystem: argv.format,
        readonly: argv['read-only'],
        permanent: argv.permanent,
        id: argv.id
      });

      TablePrinter.print([result], [{key: 'Host', value: x => x.host},
        {key: 'Image', value: x => x.image},
        {key: 'Id', value: x => x.rbdId},
        {key: 'Device', value: x => x.device},
        {key: 'Size', value: x => x.diskSize ? SizeParser.stringify(x.diskSize) : ''},
        {key: 'Used', value: x => x.diskUsed ? SizeParser.stringify(x.diskUsed) : ''},
        {key: 'MountPoint', value: x => x.location},
        {key: 'ReadOnly', value: x => x.readOnly ? 'RO' : 'RW'},
        {key: 'FileSystem', value: x => x.fileSystem || ''}]);
    },

    umount: async (argv, proxy) => {
      if (!argv.image) {
        return false;
      }

      patience();

      const result = await proxy.rbd.umount({
        image: argv.image,
        host: argv.host,
        pool: argv.pool,
        id: argv.id
      });

      if (result.length < 1) {
        console.log('WARN: Image failed to unmount from nodes or is not already mounted.');
      }
      else {
        TablePrinter.print(result, [{key: 'Host', value: x => x.host},
          {key: 'Mount Point', value: x => x.mountPoint || ''}]);
      }
    },

    automount: async (argv, proxy) => {
      patience();

      const result = (await proxy.rbd.automount({host: argv.host}))
        .map(x => x.mountPoints.map(y => Object.assign(y, {host: x.host})))
        .reduce((prev, cur) => prev.concat(cur), []);

      TablePrinter.print(result, [{key: 'Host', value: x => x.host},
        {key: 'Image', value: x => x.image},
        {key: 'Id', value: x => x.rbdId},
        {key: 'Device', value: x => x.device},
        {key: 'Size', value: x => x.diskSize ? SizeParser.stringify(x.diskSize) : ''},
        {key: 'Used', value: x => x.diskUsed ? SizeParser.stringify(x.diskUsed) : ''},
        {key: 'MountPoint', value: x => x.location},
        {key: 'ReadOnly', value: x => x.readOnly ? 'RO' : 'RW'},
        {key: 'FileSystem', value: x => x.fileSystem}]);
    },

    rm: async (argv, proxy) => {
      patience();

      await proxy.rbd.rm({image: argv.image, pool: argv.pool, id: argv.id});
    },

    extend: async (argv, proxy) => {
      if (!argv.image || !argv.size) {
        return false;
      }

      patience();

      await proxy.rbd.extend({
        image: argv.image,
        size: SizeParser.parseMegabyte(argv.size),
        pool: argv.pool,
        id: argv.id
      });
    }
  }))
  .command('lshost', 'view all RPC host agents', { }, command(async (argv, proxy) => {
    for (let host of (await proxy.hosts())) {
      console.log(`${host.hostname}@${host.version} [${host.types.join(', ')}]`)
    }
  }))
  .option('rabbit', {
    describe: 'RabbitMQ Hostname',
    default: 'localhost',
    requiresArg: true
  })
  .option('topic', {
    describe: 'RabbitMQ Topic used for IPC communication',
    default: 'kaveh_cluster_ctrl',
    requiresArg: true
  })
  .option('timeout', {
    describe: 'timeout of operations in ms',
    default: 2000,
    requiresArg: true
  })
  .option('heartbeat', {
    describe: 'timeout in seconds for connection keep-alive',
    default: 10,
    requiresArg: true
  })
  .help()
  .demandCommand();
const argv = yargs.argv;

