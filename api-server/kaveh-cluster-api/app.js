"use strict";

const SwaggerExpress = require('swagger-express-mw');
const app = require('express')();
module.exports = app; // for testing
const winston = require('winston');
const expressWinston = require('express-winston');
const serverConfig = require('./config').server;
const ClusterUpdateService = require('./api/service');
const ErrorFormatter = require('../../lib/utils/ErrorFormatter');
const logger = require('logging').default('Main');

/*

docker run -td --restart=always --name mariadb -e MYSQL_ROOT_PASSWORD=1234 -p 3306:3306 mariadb:latest
docker run -td --restart=always --name redis -p 6379:6379 redis:latest

./sequelize.sh db:create
./sequelize.sh db:create --url mysql://root:1234@127.0.0.1/kluster
./sequelize.sh db:drop --url mysql://root:1234@127.0.0.1/kluster
./api-server/kaveh-cluster-api/sequelize.sh db:migrate --url mysql://root:1234@127.0.0.1/kluster

model:generate --name User --attributes firstName:string,lastName:string,email:string
migration:generate --name add-unique-index-to-username

*/

async function main() {
  await ClusterUpdateService.run();

  const config = {
    appRoot: __dirname, // required config
    api: true,
    swaggerSecurityHandlers: require('./api/helpers/securityHandlers')
  };

  SwaggerExpress.create(config, function (err, swaggerExpress) {
    if (err) {
      logger.error(ErrorFormatter.format(err));
      process.exit(-1);
    }

    app.use(expressWinston.logger({
      transports: [
        new winston.transports.Console({
          json: false,
          colorize: true
        })
      ],
      meta: false,
      expressFormat: true,
      colorize: true
    }));

    // install middleware
    swaggerExpress.register(app);

    const port = process.env.PORT || serverConfig.port || 3500;
    app.listen(port);

    console.log('!! API server is up!');
    console.log('!! to view swagger schema definition, simply open');
    console.log('!! \'http://127.0.0.1:' + port + '/swagger\' in your browser');
    console.log('!! enjoy!');
    console.log();
    console.log();

    if (swaggerExpress.runner.swagger.paths['/hello']) {
      console.log('try this:\ncurl http://127.0.0.1:' + port + '/hello?name=Scott');
    }
  });
}

main().then(() => { }).catch(err => {
  logger.error(ErrorFormatter.format(err));
  process.exit(-1);
});
