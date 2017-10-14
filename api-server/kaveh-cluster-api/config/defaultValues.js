"use strict";

module.exports = {
  development: {
    server: {
      port: 3500,
      retry: 6,
      retry_wait: 10000
    },
    database: {
      username: 'root',
      password: '1234',
      database: 'kluster',
      host: '127.0.0.1',
      port: 0,
      dialect: 'mysql'
    },
    redis: {
      host: '127.0.0.1',
      port: 6379
    },
    runner: {
      update_every: 600,
      timeout: 900
    }
  },
  test: {
    server: {
      port: 3500,
      retry: 6,
      retry_wait: 10000
    },
    database: {
      username: 'root',
      password: '1234',
      database: 'kluster',
      host: '127.0.0.1',
      port: 0,
      dialect: 'mysql'
    },
    redis: {
      host: '127.0.0.1',
      port: 6379
    },
    runner: {
      update_every: 600,
      timeout: 900
    }
  },
  production: {
    server: {
      port: 3500,
      retry: 6,
      retry_wait: 10000
    },
    database: {
      username: 'root',
      password: '1234',
      database: 'kluster',
      host: '127.0.0.1',
      port: 0,
      dialect: 'mysql'
    },
    redis: {
      host: '127.0.0.1',
      port: 6379
    },
    runner: {
      update_every: 600,
      timeout: 900
    }
  }
};
