"use strict";

const ClientLoop = require('./lib/rpc/ClientLoop');
const Proxy = require('./lib/proxy');
const UTCClock = require('utc-clock');
const AgeReporter = require('./lib/utils/AgeReporter');
const TablePrinter = require('./lib/utils/TablePrinter');
const SizeParser = require('./lib/utils/SizeParser');
const CephAuthUtils = require('./lib/utils/CephAuthUtils');
const ImageNameParser = require('./lib/utils/ImageNameParser');
const SambaAuthUtils = require('./lib/utils/SambaAuthUtils');

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
 * @param {Array.<IScsiTarget>} shares
 */
function printIScsiTable(shares) {
  TablePrinter.print(shares, [{key: 'Host', value: x => x.host !== null ? x.host : ''},
    {key: 'IQN', value: x => x.stringifiedIqn},
    {key: 'Client', value: x => x.authentication !== null ? x.authentication.userId : ''},
    {key: 'Password', value: x => x.authentication !== null ? x.authentication.password : ''},
    {key: 'LUNs', value: x => x.luns !== null ? x.luns.sizes.map(y => SizeParser.stringify(y)) : ''},
    {key: 'Image', value: x => x.luns !== null ? ImageNameParser.parse(x.luns.image, x.luns.pool).fullName : ''},
    {key: 'Capacity', value: x => x.luns !== null ? SizeParser.stringify(x.luns.capacity) : '0'},
    {key: 'Used', value: x => x.luns !== null ? SizeParser.stringify(x.luns.used) : '0'},
    {key: 'Allocated', value: x => x.luns !== null ? SizeParser.stringify(x.luns.sizes.reduce((p, c) => p + c, 0)) : 0}]);

  console.log();
}

/**
 * @param {WorkerInfoResponse} hosts
 */
function printHosts(hosts) {
  TablePrinter.print(hosts, [{key: 'Host', value: x => x.hostname},
    {key: 'Version', value: x => x.version},
    {key: 'Types', value: x => x.types.reduce((prev, cur) => {
      if (prev.length < 1 || prev[prev.length - 1].length >= 5) {
        prev.push([cur]);
      }
      else {
        prev[prev.length - 1].push(cur);
      }

      return prev;
    }, []).map(x => x.join(', '))},
    {key: 'IP', value: x => x.ip}]);

  console.log();
}

/**
 * @param {IScsiWorkerInfoResponse} hosts
 */
function printIScsiHosts(hosts) {
  TablePrinter.print(hosts, [{key: 'Host', value: x => x.hostname},
    {key: 'Version', value: x => x.version},
    {key: 'Discovery UserId', value: x => x.discovery !== null ? x.discovery.userId : ''},
    {key: 'Discovery Password', value: x => x.discovery !== null ? x.discovery.password : ''},
    {key: 'IP', value: x => x.ip}]);

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
      printHosts(await proxy.ceph.hosts());
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

        console.log();
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
      console.log();
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
    },
    force: {
      describe: 'used to force unmounting rbd device',
      default: false,
      requiresArg: false
    }
  }, subcommand({
    ls: async (argv, proxy) => {
      (await proxy.rbd.ls({pool: argv.pool, id: argv.id})).forEach(x => console.log(x));
      console.log();
    },

    lshost: async (argv, proxy) => {
      printHosts(await proxy.rbd.hosts());
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
        console.log();
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
      console.log();
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
      console.log();
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
      console.log();
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
        id: argv.id,
        force: argv.force
      });

      if (result.length < 1) {
        console.log('WARN: Image failed to unmount from nodes or is not already mounted.');
      }
      else {
        TablePrinter.print(result, [{key: 'Host', value: x => x.host},
          {key: 'Mount Point', value: x => x.mountPoint || ''}]);
        console.log();
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
      console.log();
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
  .command('iscsi <add|ls|lshost|del|enable-auth|disable-auth|rename|add-lun|extend|enable-discovery-auth|disable-discovery-auth> [name]', 'manage iSCSI shares over RBD', {
    host: {
      describe: 'host to work with iscsi shares',
      default: '*',
      requiresArg: true
    },

    'destroy-data': {
      describe: 'whether to delete all data when deleting iscsi share',
      default: false,
      requiresArg: true
    },

    'password': {
      describe: 'password to set on iscsi shares',
      default: '-',
      requiresArg: true
    },

    'new-name': {
      describe: 'new name to apply to iscsi share',
      default: '-',
      requiresArg: true
    },

    size: {
      describe: 'size of new lun to add',
      default: 0,
      requiresArg: true
    },

    domain: {
      describe: 'domain part for iscsi creation',
      default: 'kstorage.org',
      requiresArg: true
    },

    image: {
      describe: 'rbd image to use for iscsi creation',
      default: '-',
      requiresArg: true
    }
  }, subcommand({
    lshost: async (argv, proxy) => {
      printIScsiHosts(await proxy.iscsi.hosts());
    },

    ls: async (argv, proxy) => {
      patience();
      printIScsiTable(await proxy.iscsi.ls(argv.host));
      console.log();
    },

    add: async (argv, proxy) => {
      if (!argv.name || !argv.domain || !argv.size || !argv.image || argv.image === '-') {
        return false;
      }

      patience();
      const image = ImageNameParser.parse(argv.image, '*');

      const share = await proxy.iscsi.add({
        name: argv.name,
        host: argv.host,
        domain: argv.domain,
        image: image.image,
        pool: image.pool,
        size: SizeParser.parseMegabyte(argv.size)
      });

      printIScsiTable([share]);
    },

    del: async (argv, proxy) => {
      if (!argv.name) {
        return false;
      }

      patience();
      await proxy.iscsi.del(argv.name, argv['destroy-data']);

      console.log('deleted');
    },

    'enable-auth': async (argv, proxy) => {
      if (!argv.name || !argv.password || argv.password === '-') {
        return false;
      }

      patience();
      printIScsiTable([await proxy.iscsi.enableAuthentication(argv.name, argv.password)]);
    },

    'disable-auth': async (argv, proxy) => {
      if (!argv.name) {
        return false;
      }

      patience();
      printIScsiTable([await proxy.iscsi.disableAuthentication(argv.name)]);
    },

    rename: async (argv, proxy) => {
      if (!argv.name || !argv['new-name'] || argv['new-name'] === '-') {
        return false;
      }

      patience();
      printIScsiTable([await proxy.iscsi.rename(argv.name, argv['new-name'])]);
    },

    'add-lun': async (argv, proxy) => {
      if (!argv.name || !argv.size) {
        return false;
      }

      patience();

      printIScsiTable([await proxy.iscsi.addLun(argv.name, SizeParser.parseMegabyte(argv.size))]);
    },

    extend: async (argv, proxy) => {
      if (!argv.name || !argv.size) {
        return false;
      }

      patience();

      printIScsiTable([await proxy.iscsi.extend(argv.name, SizeParser.parseMegabyte(argv.size))]);
    },

    'enable-discovery-auth': async (argv, proxy) => {
      if (!argv.host || argv.host === '*' || argv.host === '-' || !argv.password || argv.password === '-') {
        return false;
      }

      patience();
      await proxy.iscsi.enableDiscoveryAuthentication({
        host: argv.host,
        domain: argv.domain,
        password: argv.password
      });

      console.log('enabled');
    },

    'disable-discovery-auth': async (argv, proxy) => {
      if (!argv.host || argv.host === '*' || argv.host === '-') {
        return false;
      }

      patience();
      await proxy.iscsi.disableDiscoveryAuthentication(argv.host);

      console.log('disabled');
    }
  }))
  .command('samba <add|ls|del|lshost|add-user|del-user|edit|rename|edit-user|details|extend> [share]', 'manage samba shares over RBD', {
    image: {
      describe: 'rbd image to use for mapping of samba share',
      default: '-',
      requiresArg: true
    },
    host: {
      describe: 'optional hostname of samba machine to perform mappings or operations on',
      default: '*',
      requiresArg: true
    },
    hidden: {
      describe: 'whether or not samba share should be hidden (not browsable)',
      default: null,
      requiresArg: false
    },
    comment: {
      describe: 'optional comment message to add to new created share',
      default: '-',
      requiresArg: true
    },
    'guest-permission': {
      describe: 'whether guests should be allowed on newly created share (read|write|denied)',
      default: '',
      requiresArg: false
    },
    'rbd-id': {
      describe: 'RBD client id used to communicate with ceph',
      default: 'admin',
      requiresArg: true
    },
    permission: {
      describe: 'permission to apply on users (read|write|denied)',
      default: '-',
      requiresArg: true
    },
    password: {
      describe: 'password of user',
      default: '-',
      requiresArg: true
    },
    username: {
      describe: 'samba username to create or edit',
      default: '-',
      requiresArg: true
    },
    'new-name': {
      describe: 'new name to apply to a samba share',
      default: '-',
      requiresArg: true
    },
    'size': {
      describe: 'amount to extend a share (e.g. 50mb)',
      default: '0',
      requiresArg: true
    }
  }, subcommand({
    lshost: async (argv, proxy) => {
      printHosts(await proxy.samba.hosts());
    },

    add: async (argv, proxy) => {
      if (!argv.share || !argv.image || argv.image === '-') {
        return false;
      }

      patience();

      if ((await proxy.samba.exists(argv.share))) {
        throw new Error(`[ERR] share already exists: ${argv.share}`);
      }

      const imageName = ImageNameParser.parse(argv.image, '*');
      const newShare = {
        image: imageName.image,
        pool: imageName.pool,
        id: argv['rbd-id'],
        guest: SambaAuthUtils.parsePermission(argv['guest-permission'] || 'denied'),
        name: argv.share,
        comment: argv.comment || '',
        browsable: !(argv.hidden === null ? false : argv.hidden),
        capacity: null,
        used: null,
        host: null,
        acl: {}
      };

      const result = await proxy.samba.add(newShare, argv.host);

      TablePrinter.print([result], [{key: 'Host', value: x => x.host},
        {key: 'Name', value: x => x.name},
        {key: 'Hidden', value: x => (!x.browsable) ? 'Yes' : 'No'},
        {key: 'Image', value: x => ImageNameParser.parse(x.image, x.pool).fullName},
        {key: 'Size', value: x => SizeParser.stringify(x.capacity)},
        {key: 'Used', value: x => SizeParser.stringify(x.used)}]);
      console.log();
    },

    del: async (argv, proxy) => {
      if (!argv.share) {
        return false;
      }

      patience();

      await proxy.samba.del(argv.share);
      console.log('deleted');
    },

    ls: async (argv, proxy) => {
      TablePrinter.print(await proxy.samba.ls(argv.host), [{key: 'Host', value: x => x.host},
        {key: 'Name', value: x => x.name},
        {key: 'Hidden', value: x => (!x.browsable) ? 'Yes' : 'No'},
        {key: 'Image', value: x => ImageNameParser.parse(x.image, x.pool).fullName},
        {key: 'Size', value: x => SizeParser.stringify(x.capacity)},
        {key: 'Used', value: x => SizeParser.stringify(x.used)}]);
      console.log();
    },

    'add-user': async (argv, proxy) => {
      if (!argv.share || !argv.permission || argv.permission === '-' || !argv.username || argv.username === '-') {
        return false;
      }

      if (argv.password === '-') {
        argv.password = '';
      }

      patience();

      const acl = {
        password: argv.password,
        permission: SambaAuthUtils.parsePermission(argv.permission)
      };

      await proxy.samba.addUser(argv.share, argv.username, acl);
      console.log('updated');
    },

    'edit-user': async (argv, proxy) => {
      if (!argv.share || !argv.username || argv.username === '-') {
        return false;
      }

      patience();

      const user = await proxy.samba.getUser(argv.share, argv.username);

      if (argv.password && argv.password !== '-') {
        user.password = argv.password;
      }

      if (argv.permission && argv.permission !== '-') {
        user.permission = SambaAuthUtils.parsePermission(argv.permission);
      }

      await proxy.samba.editUser(argv.share, argv.username, user);
      console.log('updated');
    },

    'del-user': async (argv, proxy) => {
      if (!argv.share || !argv.username || argv.username === '-') {
        return false;
      }

      patience();

      await proxy.samba.delUser(argv.share, argv.username);
      console.log('updated');
    },

    edit: async (argv, proxy) => {
      if (!argv.share) {
        return false;
      }

      patience();

      const share = await proxy.samba.getShare(argv.share);

      if (argv.image && argv.image !== '-') {
        const imageName = ImageNameParser.parse(argv.image, '*');
        share.image = imageName.image;
        share.pool = imageName.pool;
      }

      try {
        share.guest = SambaAuthUtils.parsePermission(argv['guest-permission']);
      }
      catch (err) {
      }

      if (argv.comment && argv.comment !== '-') {
        share.comment = argv.comment;
      }

      if (argv.hidden !== null) {
        share.hidden = !argv.hidden;
      }

      await proxy.samba.update(share);
      console.log('updated');
    },

    rename: async (argv, proxy) => {
      if (!argv.share || !argv['new-name'] || argv['new-name'] === '-') {
        return false;
      }

      patience();

      await proxy.samba.rename(argv.share, argv['new-name']);
      console.log('updated');
    },

    details: async (argv, proxy) => {
      if (!argv.share) {
        return false;
      }

      patience();

      const share = await proxy.samba.getShare(argv.share);

      console.log(`Share: ${share.name}`);
      console.log(`Location: ${share.host}`);
      console.log(`Image: ${ImageNameParser.parse(share.image, share.pool).fullName}`);
      console.log(`Hidden: ${share.browsable ? 'No' : 'Yes'}`);
      console.log(`Capacity: ${SizeParser.stringify(share.capacity)}`);
      console.log(`Used: ${SizeParser.stringify(share.used)}`);
      console.log(`Comment: ${share.comment}`);
      console.log();
      console.log(`Guest Permission: ${SambaAuthUtils.stringifyPermission(share.guest)}`);
      console.log();

      TablePrinter.print(Object.entries(share.acl), [{key: 'Username', value: ([user]) => user},
        {key: 'Password', value: ([,acl]) => acl.password},
        {key: 'Permission', value: ([,acl]) => SambaAuthUtils.stringifyPermission(acl.permission)}]);
      console.log();
    },

    extend: async (argv, proxy) => {
      if (!argv.share || !argv.size || argv.size === '0') {
        return false;
      }

      patience();

      await proxy.samba.extend(argv.share, SizeParser.parseMegabyte(argv.size));
      console.log('updated');
    }
  }))
  .command('lshost', 'view all RPC host agents', { }, command(async (argv, proxy) => {
    printHosts(await proxy.hosts());
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

