"use strict";
/*
warning: fast-diff map is not enabled for kaveh-hq1. operation may be slow.
NAME      PROVISIONED USED
kaveh-hq1       9765G 609G
 */

const CephPool = require('./lib/ceph/CephPoolClient');

async function main() {
  console.log(await CephPool.ls());
}

main().catch(err => {
  console.log('[ERR :(]\n', err);
  process.exit(-1);
});

