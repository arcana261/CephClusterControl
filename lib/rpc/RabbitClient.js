"use strict";

const amqp = require('amqplib');
const log = require('logging').default('rabbitmq');

class RabbitClient {
  constructor (connectionString) {
    this._connectionString = connectionString;
    this._started = false;
    this._connection = null;
    this._channel = null;
  }

  get connectionString() {
    return this._connectionString;
  }

  get isStarted() {
    return this._started;
  }

  get connection() {
    return this._connection;
  }

  get channel() {
    return this._channel;
  }

  async _reconnectDepth(retry) {
    if (retry < 0) {
      log.error('giving up on reconnecting to RabbitMQ');
      process.exit(-1);
    }
    else {
      try {
        await this.stop();
      }
      catch (err) {
        log.error(err);
      }

      try {
        await this._start();
        log.info('reconnection succeeded :)');
      }
      catch (err) {
        log.error('reconnection failed :(');
        log.error(err);
        log.error('reconnection scheduled in 10 seconds...');
        setTimeout(() => this._reconnectDepth(retry - 1), 10000);
      }
    }
  }

  async _reconnect() {
    log.error('lost connection to RabbitMQ, reconnecting...');
    await this._reconnectDepth(10);
  }

  async start() {
    await this._startDepth(10);
  }

  _startDepthHelper(resolve, reject, retry) {
    if (retry < 0) {
      log.error('giving up on connecting to RabbitMQ');
      process.exit(-1);
    }
    else {
      this._start().then(() => resolve()).catch(err => {
        log.error('failed to connect :(');
        log.error(err);
        log.error('connection scheduled in 10 seconds...');
        setTimeout(() => this._startDepthHelper(resolve, reject, retry - 1), 10000);
      });
    }
  }

  _startDepth(retry) {
    return new Promise((resolve, reject) => {
      this._startDepthHelper(resolve, reject, retry);
    });
  }

  async _start() {
    if (!this.isStarted) {
      try {
        this._started = true;
        this._connection = await amqp.connect(this.connectionString);
        this._channel = await this._connection.createChannel();

        this._channel.on('close', () => this._reconnect());
        this._channel.on('error', () => this._reconnect());
      }
      catch (err) {
        this._started = false;

        if (this._connection) {
          await this._connection.close();
        }
        this._connection = null;
        this._channel = null;

        throw err;
      }
    }
  }

  async stop() {
    if (this.isStarted) {
      this._started = false;

      if (this._connection) {
        this._connection.close();
      }

      this._connection = null;
      this._channel = null;
    }
  }
}

module.exports = RabbitClient;
