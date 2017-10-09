"use strict";

module.exports = {
  development: {
    server: {
      port: 3500
    },
    database: {
      username: 'root',
      password: '1234',
      database: 'kluster',
      host: '127.0.0.1',
      port: 3306,
      dialect: 'mysql'
    },
    redis: {
      host: '127.0.0.1',
      port: 6379
    }
  },
  test: {
    server: {
      port: 3500
    },
    database: {
      username: 'root',
      password: '1234',
      database: 'kluster',
      host: '127.0.0.1',
      port: 3306,
      dialect: 'mysql'
    },
    redis: {
      host: '127.0.0.1',
      port: 6379
    }
  },
  production: {
    server: {
      port: 3500
    },
    database: {
      username: 'root',
      password: '1234',
      database: 'kluster',
      host: '127.0.0.1',
      port: 3306,
      dialect: 'mysql'
    },
    redis: {
      host: '127.0.0.1',
      port: 6379
    }
  }
};
