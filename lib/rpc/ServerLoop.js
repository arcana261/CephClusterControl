"use strict";

const RabbitClient = require('./RabbitClient');
const os = require('os');
const objectPath = require('nested-property');
const typeCheck = require('type-check').typeCheck;
const uuid = require('uuid/v4');
const log = require('logging').default('server');
const ErrorFormatter = require('../utils/ErrorFormatter');
const Ethernets = require('../utils/Ethernets');
const Distro = require('../utils/Distro');

/**
 * @typedef {object} WorkerInfoResponseItem
 * @property {Array.<string>} types
 * @property {string} hostname
 * @property {string} version
 * @property {Array.<string>} ip
 * @property {DistroObject} distro
 */

/**
 * @typedef {Array.<WorkerInfoResponseItem>} WorkerInfoResponse
 */

class ServerLoop extends RabbitClient {
  /**
   * @param {string} connectionString
   * @param {string} topicName
   */
  constructor (connectionString, topicName) {
    super(connectionString);

    this._types = [];
    this._topicName = topicName;
    this._hostname = os.hostname();
    this._handlers = {};
    this._instanceId = uuid();
  }

  /**
   * @returns {string}
   */
  get topicName() {
    return this._topicName;
  }

  /**
   * @returns {string}
   */
  get hostname() {
    return this._hostname;
  }

  /**
   * @returns {Array.<String>}
   */
  get types() {
    return this._types;
  }

  /**
   * @returns {string|null}
   */
  get queueName() {
    return this._queue ? this._queue.queue : null;
  }

  /**
   * @returns {string}
   */
  get instanceId() {
    return this._instanceId;
  }

  /**
   * @param {string} type
   * @returns {Promise.<void>}
   */
  async addType(type) {
    if (this._types.indexOf(type) < 0) {
      this._types.push(type);

      if (this.isStarted) {
        await this.channel.bindQueue(this._queue.queue, this._topicName, `${type}.${this._hostname}`);
        await this.channel.bindQueue(this._queue.queue, this._topicName, `${type}.?`);

        let queueName = `${this._topicName}_${type}`;
        await this.channel.assertQueue(queueName, {durable: false});
        this._consume(queueName);
      }
    }
  }

  /**
   * @param {string} type
   * @returns {Promise.<void>}
   */
  async removeType(type) {
    let idx = this._types.indexOf(type);

    if (idx >= 0) {
      this._types.splice(idx, 1);

      if (this.isStarted) {
        await this.channel.unbindQueue(this._queue.queue, this._topicName, `${type}.${this._hostname}`);
        await this.channel.unbindQueue(this._queue.queue, this._topicName, `${type}.?`);
      }
    }
  }

  /**
   * @param {*} msg
   * @param {*} reply
   * @returns {Promise.<void>}
   * @private
   */
  async _sendReply(msg, reply) {
    await this.channel.sendToQueue(msg.properties.replyTo, Buffer.from(JSON.stringify(reply)),
      { correlationId: msg.properties.correlationId });
  }

  /**
   * @param {*} msg
   * @param {*} err
   * @returns {Promise.<void>}
   * @private
   */
  async _sendError(msg, err) {
    await this._sendReply(msg, {
      success: false,
      data: ErrorFormatter.format(err),
      hostname: this._hostname,
      instanceId: this._instanceId
    });
  }

  /**
   * @param {*} msg
   * @param {*} data
   * @returns {Promise.<void>}
   * @private
   */
  async _sendResult(msg, data) {
    await this._sendReply(msg, {
      success: true,
      data: data,
      hostname: this._hostname,
      instanceId: this._instanceId
    });
  }

  addHandler(key, handler) {
    this._handlers[key] = handler;
  }

  removeHandler(key) {
    delete this._handlers[key];
  }

  async _processMessage(msg) {
    const id = uuid().split('-')[0];

    try {
      const { method, args, host } = JSON.parse(msg.content.toString());

      if (!typeCheck('String', method) || !typeCheck('String', host) || !Array.isArray(args)) {
        throw new Error(`bad arguments: ${msg.content.toString()}`);
      }

      log.info(`[${id}][?] ${host}:${msg.properties.replyTo}@${msg.properties.correlationId} -> ${method}@[${args.join(', ')}]`);

      if (!objectPath.has(this._handlers, method)) {
        throw new Error(`handler not found: ${method}`);
      }

      const lastDot = method.lastIndexOf('.');
      const parent = lastDot >= 0 ? objectPath.get(this._handlers, method.substr(0, lastDot)) : this._handlers;

      const target = objectPath.get(this._handlers, method);
      const result = await target.apply(parent, args);

      log.info(`[${id}][:)] ${method}@[${args.join(', ')}] -> ${JSON.stringify(result)} -> ` +
        `${host}:${msg.properties.replyTo}@${msg.properties.correlationId}`);

      await this._sendResult(msg, result);
    }
    catch (err) {
      log.error(`[${id}][:(] ${ErrorFormatter.format(err)}`);

      await this._sendError(msg, err);
    }
    finally {
      await this.channel.ack(msg);
    }
  }

  _consume(queue) {
    this.channel.consume(queue, async msg => this._processMessage(msg), {noAck: false});
  }

  async start() {
    if (!this.isStarted) {
      await super.start();

      try {
        await this.channel.prefetch(1);
        await this.channel.assertExchange(this._topicName, 'topic', {durable: false});
        this._queue = await this.channel.assertQueue('', {exclusive: true});

        await this.channel.bindQueue(this._queue.queue, this._topicName, `*.${this._hostname}`);

        for (let type of this._types) {
          await this.channel.bindQueue(this._queue.queue, this._topicName, `${type}.${this._hostname}`);
          await this.channel.bindQueue(this._queue.queue, this._topicName, `${type}.?`);

          let queueName = `${this._topicName}_${type}`;
          await this.channel.assertQueue(queueName, {durable: false});
          this._consume(queueName);
        }

        this._consume(this._queue.queue);

        const self = this;

        this.addHandler('_system', {
          info: async function () {
            let ethers = [];

            try {
              ethers = (await Ethernets.ls())
                .map(x => x.ipv4)
                .reduce((prev, cur) => prev.concat(cur), [])
                .map(x => x.address);
            }
            catch (err) {
              log.warn(ErrorFormatter.format(err));
            }

            return {
              types: self._types,
              hostname: self._hostname,
              version: require('../../package.json').version,
              ip: ethers,
              distro: await Distro.getDistro()
            };
          }
        });

        await this.addType('worker');
      }
      catch (err) {
        await super.stop();
        throw err;
      }
    }
  }
}

module.exports = ServerLoop;

