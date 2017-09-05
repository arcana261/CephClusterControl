"use strict";

const ServerLoop = require('../lib/rpc/ServerLoop');

async function main() {
  let server = new ServerLoop('amqp://localhost?heartbeat=10', 'sample');

  await server.start();

  server.addHandler('mehdi', {
    hello: function() {
      return 'hello, world!';
    }
  });

  await server.addType('info');
}

main().catch(err => {
  console.log('[ERR :(]\n', err);
  process.exit(-1);
});
