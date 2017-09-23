"use strict";

const objectPath = require('nested-property');
const fs = require('mz/fs');
const ErrorFormatter = require('../lib/utils/ErrorFormatter');

const [key, path] = process.argv.slice(2);

async function main() {
  const obj = JSON.parse(await fs.readFile(path, 'utf8'));

  if (!objectPath.has(obj, key)) {
    console.log('');
  }
  else {
    console.log(objectPath.get(obj, key));
  }
}

main().catch(err => {
  console.log('[ERR :(]\n', ErrorFormatter.format(err));
  process.exit(-1);
});
