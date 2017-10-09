"use strict";

const env = require('./env');
const defaultValues = require('./defaultValues')[env];
const config = require('./config')[env];
const EtcParser = require('../../../lib/utils/EtcParser');

/**
 * @type {{
 * server: {
 * port: number
 * },
 * database: {
 * host: string,
 * port: number,
 * username: string,
 * password: string,
 * database: string,
 * dialect: string
 * },
 * redis: {
 * host: string
 * port: number
 * }
 * }}
 */
module.exports = EtcParser.readSync(config.etc, defaultValues);
