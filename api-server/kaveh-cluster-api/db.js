"use strict";

const Shell = require('../../lib/utils/Shell');
const args = process.argv.slice(2);
const config = require('./config').database;
const path = require('path');
const ErrorFormatter = require('../../lib/utils/ErrorFormatter');

const url =
  `${config.dialect}://${config.username}:${config.password}@${config.host}${config.port ? `:${config.port}` : ''}/${config.database}`;

Shell.execWatched(
  data => console.log(data),
  data => console.error(data),
  path.join(__dirname, 'sequelize.sh'), args.join(' '), '--url', url)
  .then(out => process.exit(0))
  .catch(err => {
    console.error(ErrorFormatter.format(err));
    process.exit(-1);
  });
