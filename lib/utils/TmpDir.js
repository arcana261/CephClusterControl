"use strict";

const path = require('path');

module.exports =
  process.env.NODE_ENV === 'development' ?
    path.join(__dirname, '../../data/tmp') : '/tmp';

