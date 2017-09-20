"use strict";

const Ethernets = require('../lib/utils/Ethernets');

async function main() {
  console.log(JSON.stringify(await Ethernets.ls(), null, 2));
}

main().catch(err => {
  console.log('[ERR :(]\n', err);
  process.exit(-1);
});
