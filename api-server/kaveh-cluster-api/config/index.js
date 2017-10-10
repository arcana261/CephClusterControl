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
    describe: 'type of database server, currently only "mysql" and "postgres" are supported',
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
  .option('runner-update-rate', {
    describe: 'seconds to update cluster information',
    default: parsedConfig.runner.update_every,
    check: isInteger
  })
  .option('runner-timeout', {
    describe: 'seconds to timeout cluster information updating and restarting again',
    default: parsedConfig.runner.timeout,
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
  },
  runner: {
    update_every: parseInt(yargs['runner-update-rate']),
    timeout: parseInt(yargs['runner-timeout'])
  }
};
