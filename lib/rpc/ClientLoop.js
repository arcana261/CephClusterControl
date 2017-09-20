"use strict";

const RabbitClient = require('./RabbitClient');
const uuid = require('uuid/v4');
const os = require('os');

class ClientLoop extends RabbitClient {
  constructor (connectionString, topicName, {timeout = 2000} = {}) {
    super (connectionString);

    this._topicName = topicName;
    this._timeout = timeout;
    this._handlers = {};
  }

  _callBase(target, method, args, {timeout = 0, broadcast = false, publish = true, waitForHosts = []}) {
    return new Promise(async (resolve, reject) => {
      try {
        if (!this.isStarted) {
          throw new Error('ClientLoop is not started');
        }

        const wait = timeout || this._timeout;
        const correlationId = uuid();
        let processed = false;
        const waitForHostEnabled = waitForHosts && waitForHosts.length > 0;
        const pendingHosts = new Set(waitForHosts || []);

        let aggregatedResult = {};

        let timeoutHandle = null;

        if (wait > 0) {
          timeoutHandle = setTimeout(() => {
            if (!processed) {
              try {
                delete this._handlers[correlationId];
                processed = true;

                if (!broadcast) {
                  reject(new Error('timeout while waiting for response'));
                }
                else {
                  resolve(aggregatedResult);
                }
              }
              catch (err) {
                reject(err);
              }
            }
          }, wait);
        }

        this._handlers[correlationId] = async msg => {
          if (!processed) {
            try {
              if (!broadcast) {
                delete this._handlers[correlationId];

                clearTimeout(timeoutHandle);
                processed = true;

                let {success, data} = JSON.parse(msg.content.toString());

                if (success) {
                  resolve(data);
                }
                else {
                  reject(data);
                }
              }
              else {
                let result = JSON.parse(msg.content.toString());

                aggregatedResult[result.hostname] =
                  Object.assign(aggregatedResult[result.hostname] || {}, {
                    [result.instanceId]: result
                  });

                if (waitForHostEnabled) {
                  pendingHosts.delete(result.hostname);

                  if (pendingHosts.size < 1) {
                    delete this._handlers[correlationId];

                    clearTimeout(timeoutHandle);
                    processed = true;

                    resolve(aggregatedResult);
                  }
                }
              }
            }
            catch (err) {
              delete this._handlers[correlationId];
              clearTimeout(timeoutHandle);
              processed = true;

              reject(err);
            }
          }
        };

        const bufferToSend = Buffer.from(JSON.stringify({
          method: method,
          args: args,
          host: os.hostname()
        }));

        if (publish) {
          await this.channel.publish(this._topicName, target, bufferToSend,
            {replyTo: this._queue.queue, correlationId: correlationId});
        }
        else {
          await this.channel.sendToQueue(`${this._topicName}_${target}`, bufferToSend,
            {replyTo: this._queue.queue, correlationId: correlationId});
        }
      }
      catch (err) {
        reject(err);
      }
    });
  }

  call(targetType, hostname, method, args, {timeout = 0} = {}) {
    return this._callBase(`${targetType}.${hostname}`, method, args,
      {timeout: timeout, broadcast: false, publish: true});
  }

  broadcastType(targetType, method, args, {timeout = 0, waitForHosts = []} = {}) {
    return this._callBase(`${targetType}.?`, method, args,
      {timeout: timeout, broadcast: true, publish: true, waitForHosts: waitForHosts});
  }

  broadcastHost(hostname, method, args, {timeout = 0, waitForHosts = []} = {}) {
    return this._callBase(`*.${hostname}`, method, args,
      {timeout: timeout, broadcast: true, publish: true, waitForHosts: waitForHosts});
  }

  enqueue(targetType, method, args, {timeout = 0} = {}) {
    return this._callBase(targetType, method, args,
      {timeout: timeout, broadcast: false, publish: false});
  }

  /**
   * @returns {Promise.<WorkerInfoResponse>}
   */
  async listHostsForType(targetType) {
    return Object.entries(await this.broadcastType(targetType, '_system.info', []))
      .map(x => Object.entries(x[1]).filter(y => y[1].success)[0][1].data)
  }

  /**
   * @returns {Promise.<Array.<String>>}
   */
  async listTypesForHost(hostname) {
    let response = (await this.broadcastHost(hostname, '_system.info', []))[hostname];

    return Array.from(new Set(Object.keys(response).map(x => response[x].success ? response[x].data.types : [])
      .reduce((prev, current) => prev.concat(current), [])));
  }

  /**
   * @returns {Promise.<Array.<{types: Array.<String>, hostname: String, version: String}>>}
   */
  listHosts() {
    return this.listHostsForType('worker');
  }

  async start() {
    if (!this.isStarted) {
      await super.start();

      try {
        await this.channel.assertExchange(this._topicName, 'topic', {durable: false});
        this._queue = await this.channel.assertQueue('', {exclusive: true});

        this.channel.consume(this._queue.queue, async msg => {
          const correlationId = msg.properties.correlationId;

          if (correlationId in this._handlers) {
            await this._handlers[correlationId](msg);
          }
        }, {noAck: true});
      }
      catch (err) {
        await super.stop();
        throw err;
      }
    }
  }
}

module.exports = ClientLoop;
