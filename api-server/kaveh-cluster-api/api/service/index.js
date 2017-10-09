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
        return await runner.run();
      });
    }

    const task = tasks[clusterName];

    try {
      await task.cancel();
      task.run();
    }
    catch (err) {
      logger.error(ErrorFormatter.format(err));
    }
  }

  /**
   * @param {string} clusterName
   * @returns {Promise.<void>}
   */
  static async stopTask(clusterName) {
    if (clusterName in tasks) {
      const task = tasks[clusterName];

      try {
        await task.cancel();
      }
      catch (err) {
        logger.error(ErrorFormatter.format(err));
      }

      delete tasks[clusterName];
    }
  }

  static async _checkTasks() {
    const clusterNames = (await Cluster.findAll()).map(x => x.name);

    for (const clusterName of clusterNames) {
      if (!(clusterName in tasks)) {
        await ClusterUpdateService.startTask(clusterName);
      }
      else {
        const task = tasks[clusterName];
        if (!task.isRunning) {

        }
      }
    }
  }

  static run() {
  }
}

module.exports = ClusterUpdateService;

