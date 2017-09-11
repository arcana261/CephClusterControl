"use strict";

const ClientLoop = require('./lib/rpc/ClientLoop');
const Proxy = require('./lib/proxy');
const UTCClock = require('utc-clock');
const AgeReporter = require('./lib/utils/AgeReporter');
const TablePrinter = require('./lib/utils/TablePrinter');
const SizeParser = require('./lib/utils/SizeParser');

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

const yargs = require('yargs')
  .command('ceph <lspool|lshost>', 'view information about ceph cluster', { }, subcommand({
    lspool: async (argv, proxy) => {
      console.log((await proxy.ceph.pool.ls()).join(', '));
    },

    lshost: async (argv, proxy) => {
      for (let host of (await proxy.ceph.hosts())) {
        console.log(`${host.hostname}@${host.version} [${host.types.join(', ')}]`)
      }
    }
  }))
  .command('rbd <ls|lshost|du|info|create|showmapped|mount|umount|automount|rm> [image] [location]', 'view information about rbd images', {
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

