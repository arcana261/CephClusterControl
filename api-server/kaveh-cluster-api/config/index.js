"use strict";

const env = require('./env');
const defaultValues = require('./defaultValues')[env];
const config = require('./config')[env];
const EtcParser = require('../../../lib/utils/EtcParser');
const types = require('../api/helpers/types');

const parsedConfig = EtcParser.readSync(config.etc, defaultValues);

function isInteger(value) {
  return value === parseInt(value);
}

const yargs = require('yargs')
  .option('rpc-rabbit-host', {
    describe: 'rabbitmq hostname',
    default: parsedConfig.rpc.rabbitmq
  })
  .option('rpc-rabbit-username', {
    describe: 'rabbitmq username',
    default: parsedConfig.rpc.username
  })
  .option('rpc-rabbit-password', {
    describe: 'rabbitmq password',
    default: parsedConfig.rpc.password
  })
  .option('rpc-heartbeat', {
    describe: 'heartbeat to keep rabbitmq connection alive',
    default: parsedConfig.rpc.heartbeat,
    check: isInteger
  })
  .option('rpc-topic', {
    describe: 'rabbitmq topic name for rpc communication with agents',
    default: parsedConfig.rpc.topic
  })
  .option('rpc-timeout', {
    describe: 'timeout for rpc calls to worker agents',
    default: parsedConfig.rpc.timeout,
    check: isInteger
  })
  .option('ceph-id', {
    describe: 'default ceph client id to use',
    default: parsedConfig.ceph.id
  })
  .option('sql-host', {
    describe: 'hostname of sql(mysql/postgresql) database server',
    default: parsedConfig.database.host
  })
  .option('sql-username', {
    describe: 'username of sql(mysql/postgresql) database server',
    default: parsedConfig.database.username
  })
  .option('sql-password', {
    describe: 'password of sql(mysql/postgresql) database server',
    default: parsedConfig.database.password
  })
  .option('sql-port', {
    describe: 'port number of sql(mysql/postgresql) database server',
    default: parsedConfig.database.port,
    check: isInteger
  })
  .option('sql-dialect', {
    describe: 'type of database server, currently only mysql and postgresql are supported',
    default: parsedConfig.database.dialect,
    choices: ['mysql', 'postgresql']
  })
  .option('database', {
    describe: 'name of database to use',
    default: parsedConfig.database.database
  })
  .option('redis-host', {
    describe: 'hostname of redis server to connect to',
    default: parsedConfig.redis.host
  })
  .option('redis-port', {
    describe: 'port to connect to redis server',
    default: parsedConfig.redis.port,
    check: isInteger
  })
  .option('port', {
    describe: 'port to listen on',
    default: parsedConfig.port,
    check: isInteger
  })
  .help()
  .argv;

/**
 * @type {{
 * rpc: {
 * rabbitmq: string,
 * username: string,
 * password: string,
 * heartbeat: number,
 * topic: string,
 * timeout: number
 * },
 * ceph: {
 * id: string
 * }
 * server: {
 * port: number
 * },
 * database: {
 * host: string,
 * port: number,
 * username: string,
 * password: string,
 * database: string,
 * dialect: string
 * },
 * redis: {
 * host: string
 * port: number
 * }
 * }}
 */
module.exports = {
  rpc: {
    rabbitmq: yargs['rpc-rabbit-host'],
    username: yargs['rpc-rabbit-username'],
    password: yargs['rpc-rabbit-password'],
    heartbeat: parseInt(yargs['rpc-heartbeat']),
    topic: yargs['rpc-topic'],
    timeout: parseInt(yargs['rpc-timeout'])
  },
  ceph: {
    id: yargs['ceph-id']
  },
  server: {
    port: parseInt(yargs['port'])
  },
  database: {
    host: yargs['sql-host'],
    port: parseInt(yargs['sql-port']),
    username: yargs['sql-username'],
    password: yargs['sql-password'],
    database: yargs['database'],
    dialect: yargs['sql-dialect']
  },
  redis: {
    host: yargs['redis-host'],
    port: parseInt(yargs['redis-port'])
  }
};
