"use strict";

const config = require('../../config');
const Task = require('./task/Task');
const ClusterUpdater = require('./ClusterUpdater');
const logger = require('logging').default('ClusterUpdateService');
const ErrorFormatter = require('../../../../lib/utils/ErrorFormatter');
const {Cluster} = require('../../models');
const OperationCanceledError = require('./task/OperationCanceledError');
const TimeoutError = require('./task/TimeoutError');
const Sleep = require('../../../../lib/utils/Sleep');

/**
 * @type {Object.<string, Task>}
 */
const tasks = {};

class ClusterUpdateService {
  /**
   * @param {string} clusterName
   * @returns {Promise.<void>}
   */
  static async startTask(clusterName) {
    if (!(clusterName in tasks)) {
      tasks[clusterName]  = new Task(async cancelationPoint => {
        const runner = new ClusterUpdater(clusterName, cancelationPoint);

        logger.info(`task for cluster "${clusterName}" started`);
        return await runner.run();
      });
    }

    const task = tasks[clusterName];

    try {
      logger.info(`starting update task for cluster "${clusterName}"`);

      if (task.isRunning) {
        try {
          await task.cancel();
        }
        catch (err) {
          logger.error(ErrorFormatter.format(err));
        }
      }

      task.run().catch(err => {
        logger.error(ErrorFormatter.format(err));
      });
    }
    catch (err) {
      logger.error(ErrorFormatter.format(err));
    }
  }

  /**
   * @param {string} clusterName
   * @returns {Promise.<void>}
   */
  static restartTask(clusterName) {
    return ClusterUpdateService.startTask(clusterName);
  }

  /**
   * @param {string} clusterName
   * @returns {Promise.<void>}
   */
  static async stopTask(clusterName) {
    if (clusterName in tasks) {
      const task = tasks[clusterName];

      try {
        logger.info(`stopping task for cluster "${clusterName}"`);
        await task.cancel();
      }
      catch (err) {
        logger.error(ErrorFormatter.format(err));
      }

      delete tasks[clusterName];

      logger.info(`task for cluster "${clusterName}" stopped`);
    }
  }

  /**
   * @returns {Promise.<void>}
   * @private
   */
  static async _checkTasks() {
    const clusterNames = (await Cluster.findAll()).map(x => x.name);

    for (const clusterName of clusterNames) {
      if (!(clusterName in tasks)) {
        await ClusterUpdateService.startTask(clusterName);
      }
      else {
        const task = tasks[clusterName];

        if (!task.isRunning) {
          const finish = task.finishTime !== null ? task.finishTime : task.startTime;
          const diff = (new Date()).getTime() - (finish !== null ? finish.getTime() : 0);

          if (diff >= config.runner.update_every * 1000) {
            await ClusterUpdateService.startTask(clusterName);
          }
        }
        else {
          const diff = (new Date()).getTime() - (task.startTime !== null ? task.startTime.getTime() : 0);

          if (diff >= config.runner.timeout * 1000) {
            logger.warn(`task timeout detected for cluster "${clusterName}"`);
            task.cancel().catch(err => {
              ErrorFormatter.format(err);
            });

            delete tasks[clusterName];

            await ClusterUpdateService.startTask(clusterName);
          }
        }
      }
    }
  }

  /**
   * @returns {Promise.<void>}
   */
  static async run() {
    await ClusterUpdateService._checkTasks();

    setInterval(() => {
      ClusterUpdateService._checkTasks().catch(err => {
        logger.error(ErrorFormatter.format(err));
      });
    }, 10000);
  }
}

module.exports = ClusterUpdateService;

