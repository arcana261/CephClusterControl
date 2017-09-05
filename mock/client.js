"use strict";

const ClientLoop = require('../lib/rpc/ClientLoop');
const os = require('os');

async function main() {
  let client = new ClientLoop('amqp://localhost?heartbeat=10', 'sample');//, {timeout: 600000});

  await client.start();

  var res = await client.call('info', os.hostname(), 'mehdi.hello', []);
  console.log(res);
}

main().catch(err => {
  console.log('[ERR :(]\n', err);
  process.exit(-1);
});
