"use strict";

const Samba = require('../lib/samba');

async function main() {
  const smb = new Samba();

  await smb._adduser('smb_mehdix');
}

main().catch(err => {
  console.log(err);
  process.exit(-1);
});

