"use strict";

const ClientLoop = require('../../../../lib/rpc/ClientLoop');
const Proxy = require('../../../../lib/proxy');
const restified = require('../helpers/restified');
const HostStatus = require('../../api/const/HostStatus');
const RbdImageStatus = require('../../api/const/RbdImageStatus');
const ImageNameParser = require('../../../../lib/utils/ImageNameParser');
const SambaAuthUtils = require('../../../../lib/utils/SambaAuthUtils');
const SambaStatus = require('../../api/const/SambaStatus');
const SequentialAsyncMap = require('../../../../lib/utils/SequentialAsyncMap');
const ScsiHostStatus = require('../const/ScsiHostStatus');
const ScsiTargetStatus = require('../const/ScsiTargetStatus');
const ScsiLunStatus = require('../const/ScsiLunStatus');
const config = require('../../config');
const Retry = require('../../../../lib/utils/Retry');
const logger = require('logging').default('ClusterUpdater');
const ErrorFormatter = require('../../../../lib/utils/ErrorFormatter');
const types = require('../helpers/types');
const RadosGatewayShareStatus = require('../const/RadosGatewayShareStatus');

const {
  Cluster,
  Host, RpcType,
  RbdImage,
  SambaUser, SambaAcl, SambaShare,
  ScsiHost, ScsiTarget, ScsiLun,
  RadosGatewayShare
} = require('../../models');

const ExtendedTimeout = 60000;

class ClusterUpdater {
  /**
   * @param {string} clusterName
   * @param {CancelationPoint|null} cancelationPoint
   */
  constructor(clusterName, cancelationPoint = null) {
    this._clusterName = clusterName;
    this._cancelationPoint = cancelationPoint;
  }

  static get ExtendedTimeoutValue() {
    return ExtendedTimeout;
  }

  /**
   * @param {IScsiTarget} actualTarget
   * @param {boolean} suspended
   * @returns {ScsiTargetModel}
   * @private
   */
  _createScsiTargetModel(actualTarget, suspended) {
    let domain = null;

    if (actualTarget.iqn.host && actualTarget.iqn.domain) {
      domain = `${actualTarget.iqn.host}.${actualTarget.iqn.domain}`;
    }
    else if (actualTarget.iqn.host) {
      domain = actualTarget.iqn.domain;
    }
    else {
      domain = '';
    }

    return {
      name: actualTarget.iqn.name,
      iqn: actualTarget.stringifiedIqn,
      requiresAuth: !!actualTarget.authentication,
      userName: actualTarget.authentication ? actualTarget.authentication.userId : null,
      password: actualTarget.authentication ? actualTarget.authentication.password : null,
      status: ScsiTargetStatus.up,
      suspended: suspended,
      domain: domain
    };
  }

  /**
   * @private
   */
  _triggerExceptionPoint() {
    if (this._cancelationPoint) {
      this._cancelationPoint.checkExceptionPoint();
    }
  }

  /**
   * @param {ClusterModel} cluster
   * @param {Proxy} proxy
   * @param {Array.<HostModel>} hosts
   * @param {Array.<string>} targets
   * @param {boolean} warnAsError
   * @param {boolean} forceUpdateMissing
   * @returns {Promise.<{
   * hosts: Array.<HostModel>,
   * targets: Array.<ScsiTargetModel>
   * }>}
   */
  async updateScsiTargets(cluster, proxy, hosts,
                          {targets = [], warnAsError = false, forceUpdateMissing = false} = {}) {
    const filteredHosts = await (restified.autocommit(async t => {
      return (await Promise.all(hosts.map(async host => {
        const types = host.RpcTypes || (await host.getRpcTypes({transaction: t}));
        host.RpcTypes = types;
        return [host, types.some(type => type.name === 'iscsi')];
      }))).map(([host, isSamba]) => isSamba ? host : null).filter(host => host !== null);
    }))();

    const isPartialUpdate = (targets instanceof Array) && targets.length > 0;

    let actualTargets = (await Promise.all(filteredHosts.map(async host => {
      try {
        return await proxy.iscsi.ls(host.hostName, {
          timeout: ExtendedTimeout,
          usage: false,
          filter: isPartialUpdate ? targets : null
        });
      }
      catch (err) {
        host.status = HostStatus.down;
        return [];
      }
    }))).reduce((prev, cur) => prev.concat(cur), []);

    if (isPartialUpdate) {
      actualTargets = actualTargets.filter(target => targets.indexOf(target.iqn.name) >= 0);
    }

    this._triggerExceptionPoint();

    const deletionList = [];
    const additionList = [];

    const fn = restified.autocommit(async t => {
      const dbTargets =
        isPartialUpdate ?
          (await Promise.all(targets.map(async targetName => {
            return (await cluster.getScsiTargets({
              where: {
                name: targetName
              },
              limit: 1,
              offset: 0,
              transaction: t
            }))[0];
          }))).filter(x => !!x) : (await cluster.getScsiTargets({transaction: t}));

      let result = [];

      for (const actualTarget of actualTargets) {
        let [target] = dbTargets.filter(x => x.iqn === actualTarget.stringifiedIqn);

        if (target) {
          Object.assign(target, this._createScsiTargetModel(actualTarget, target.suspended));
          await target.save({transaction: t});

          if (target.suspended) {
            deletionList.push(actualTarget);
          }
        }
        else {
          target = await ScsiTarget.create(this._createScsiTargetModel(actualTarget, false), {transaction: t});
          await target.setCluster(cluster, {transaction: t});
        }

        result.push(target);

        let host = await target.getScsiHost({
          include: [{
            model: Host
          }],
          transaction: t
        });

        if (!host || !host.Host || host.Host.hostName !== actualTarget.host) {
          host = (await cluster.getScsiHosts({
            include: [{
              model: Host,
              where: {
                hostName: actualTarget.host
              }
            }],
            limit: 1,
            offset: 0,
            transaction: t
          }))[0];

          if (host) {
            await target.setScsiHost(host, {transaction: t});
          }
        }

        let rbdImage = await target.getRbdImage({transaction: t});

        if (actualTarget.luns &&
          (!rbdImage || rbdImage.pool !== actualTarget.luns.pool || rbdImage.image !== actualTarget.luns.image)) {

          rbdImage = (await cluster.getRbdImages({
            where: {
              pool: actualTarget.luns.pool,
              image: actualTarget.luns.image
            },
            transaction: t,
            limit: 1,
            offset: 0
          }))[0];

          if (rbdImage) {
            await target.setRbdImage(rbdImage, {transaction: t});
          }
        }

        const luns = await target.getScsiLuns({
          transaction: t,
          order: [
            ['index', 'ASC']
          ]
        });

        if (!actualTarget.luns) {
          for (const lun of luns) {
            Object.assign(lun, {status: ScsiLunStatus.missing});
            await lun.save({transaction: t});
          }
        }
        else {
          let i = 0;
          let j = 0;

          let actualLunItems = null;

          // code below tolerates old iscsi monitoring
          // service implementations.
          //
          // old server did not return "items" but just
          // an array of sizes.
          if ('items' in actualTarget.luns) {
            actualLunItems = actualTarget.luns.items;
          }
          else {
            actualLunItems = actualTarget.luns.sizes.map((x, i) => ({
              index: i,
              size: x
            }));
          }

          for (let k = 0; k < luns.length; k++) {
            if (luns[k].index === null) {
              luns[k].index = k;
              await luns[k].save({transaction: t});
            }
          }

          while (i < luns.length && j < actualLunItems.length) {
            const lun = luns[i];
            const actualLun = actualLunItems[j];

            if (lun.index === actualLun.index) {
              Object.assign(lun, {
                size: Math.round(actualLun.size)
              });

              await lun.save({transaction: t});

              i = i + 1;
              j = j + 1;
            }
            else if (lun.index < actualLun.index) {
              Object.assign(lun, {
                status: ScsiLunStatus.missing
              });

              await lun.save({transaction: t});

              i = i + 1;
            }
            else {
              const newLun = await ScsiLun.create({
                size: Math.round(actualLun.size),
                status: ScsiLunStatus.up,
                index: actualLun.index
              });

              await newLun.setScsiTarget(target, {transaction: t});

              j = j + 1;
            }
          }

          while (i < luns.length) {
            Object.assign(luns[i], {
              status: ScsiLunStatus.missing
            });

            await luns[i].save({transaction: t});

            i = i + 1;
          }

          while (j < actualLunItems.length) {
            const newLun = await ScsiLun.create({
              size: Math.round(actualLunItems[j].size),
              status: ScsiLunStatus.up,
              index: actualLunItems[j].index
            });

            await newLun.setScsiTarget(target, {transaction: t});

            j = j + 1;
          }
        }
      }

      if (!isPartialUpdate || forceUpdateMissing) {
        const missingTargets = dbTargets.filter(x => !actualTargets.some(y => x.iqn === y.stringifiedIqn));

        for (const missingTarget of missingTargets) {
          if (!missingTarget.suspended) {
            Object.assign(missingTarget, {status: ScsiTargetStatus.missing});
            await missingTarget.save({transaction: t});

            const scsiHost = await missingTarget.getScsiHost({
              include: [{
                model: Host
              }],
              transaction: t
            });
            const rbdImage = await missingTarget.getRbdImage({transaction: t});
            const luns = await missingTarget.getScsiLuns({transaction: t});

            if (scsiHost && scsiHost.Host && rbdImage && luns && luns.length > 0) {
              const target = {
                name: missingTarget.name,
                host: scsiHost.Host.hostName,
                domain: missingTarget.domain,
                image: rbdImage.image,
                pool: rbdImage.pool,
                size: luns[0].size,
                usage: false,
                timeout: ExtendedTimeout,
                lunIndex: luns[0].index
              };

              const additionalLuns = luns.slice(1);

              additionList.push({
                target: target,
                luns: additionalLuns,
                scsiHost: scsiHost
              });
            }
          }
        }
      }

      return result;
    });

    const result = await fn();

    for (const actualTarget of deletionList) {
      try {
        await proxy.iscsi.del(actualTarget.iqn.name, false, {
          host: actualTarget.host,
          timeout: ExtendedTimeout,
          usage: false
        });
      }
      catch (err) {
        logger.warn(ErrorFormatter.format(err));
        if (warnAsError) {
          throw err;
        }
      }
    }

    for (const {target, luns, scsiHost} of additionList) {
      try {
        await proxy.iscsi.add(target);

        for (const {size, index} of luns) {
          await proxy.iscsi.addLun(target.name, size, {
            host: target.host,
            timeout: ExtendedTimeout,
            usage: false,
            index: index
          });
        }

        const additionResult = await this.updateScsiTargets(cluster, proxy, [scsiHost.Host], {
          targets: [target.name],
          warnAsError: warnAsError,
          forceUpdateMissing: false
        });

        result.push(additionResult.targets[0]);
      }
      catch (err) {
        logger.warn(ErrorFormatter.format(err));
        if (warnAsError) {
          throw err;
        }
      }
    }

    return {
      hosts: hosts.filter(x => x.status !== HostStatus.down),
      targets: result
    };
  }

  /**
   * @param {IScsiWorkerInfoResponseItem} actualHost
   * @returns {ScsiHostModel}
   * @private
   */
  _createScsiHostModel(actualHost) {
    return {
      requiresAuth: !!actualHost.discovery,
      userName: actualHost.discovery ? actualHost.discovery.userId : null,
      password: actualHost.discovery ? actualHost.discovery.password : null,
      status: ScsiHostStatus.up
    };
  }

  /**
   * @param {ClusterModel} cluster
   * @param {Proxy} proxy
   * @param {Array.<HostModel>} hosts
   * @param {boolean} isPartialUpdate
   * @returns {Promise.<{
   * hosts: Array.<HostModel>,
   * scsiHosts: Array.<ScsiHostModel>
   * }>}
   */
  async updateScsiHosts(cluster, proxy, hosts, {isPartialUpdate = false} = {}) {
    const filteredHosts = await (restified.autocommit(async t => {
      return (await Promise.all(hosts.map(async host => {
        const types = host.RpcTypes || (await host.getRpcTypes({transaction: t}));
        host.RpcTypes = types;
        return [host, types.some(type => type.name === 'iscsi')];
      }))).map(([host, isSamba]) => isSamba ? host : null).filter(host => host !== null);
    }))();

    const actualHosts = (await Promise.all(filteredHosts.map(async host => {
      try {
        return await proxy.iscsi.report(host.hostName, {timeout: ExtendedTimeout});
      }
      catch (err) {
        host.status = HostStatus.down;
        return null;
      }
    }))).filter(x => x !== null);

    this._triggerExceptionPoint();

    const fn = restified.autocommit(async t => {
      const scsiHosts = isPartialUpdate ?
        (await Promise.all(filteredHosts.map(host =>
          host.getScsiHost({
            include: [{
              model: Host
            }],
            transaction: t
          })))).filter(x => !!x) :
        await cluster.getScsiHosts({
          include: [{
            model: Host
          }],
          transaction: t
        });

      let result = [];

      for (const actualHost of actualHosts) {
        let [scsiHost] = scsiHosts.filter(x => x.Host.hostName === actualHost.hostname);

        if (scsiHost) {
          Object.assign(scsiHost, this._createScsiHostModel(actualHost));
          await scsiHost.save({transaction: t});
        }
        else {
          const [host] = await cluster.getHosts({
            where: {
              hostName: actualHost.hostname
            },
            limit: 1,
            offset: 0,
            transaction: t
          });

          if (host) {
            scsiHost = await ScsiHost.create(this._createScsiHostModel(actualHost), {transaction: t});
            await scsiHost.setHost(host, {transaction: t});
            await scsiHost.setCluster(cluster, {transaction: t});
          }
        }

        if (scsiHost) {
          result.push(scsiHost);
        }
      }

      if (!isPartialUpdate) {
        const missingScsiHosts = scsiHosts.filter(x => !x.Host || !actualHosts.some(y => x.Host.hostName === y.hostname));

        for (const missingScsiHost of missingScsiHosts) {
          Object.assign(missingScsiHost, {status: ScsiHostStatus.missing});
          await missingScsiHost.save({transaction: t});
        }
      }

      return result;
    });

    const result = await fn();

    return {
      hosts: hosts.filter(x => x.status !== HostStatus.down),
      scsiHosts: result
    };
  }

  _fixString(str) {
    if (!str || !types.isString(str)) {
      return '';
    }

    let result = '';

    for (let i = 0; i < str.length; i++) {
      const ch = str.charAt(i);

      if (/\w/.test(ch) || /\s/.test(ch) || /\d/.test(ch) || /[!@#$%^&*().,?/\\:;'"~`\-_=+|]/.test(ch)) {
        result = result + ch;
      }
    }

    return result;
  }

  /**
   * @param {RadosGatewayUser} actualShare
   * @returns {RadosGatewayShareModel}
   * @private
   */
  _createRadosGatewayShareModel(actualShare) {
    return {
      userName: actualShare.username,
      fullName: this._fixString(actualShare.fullName),
      email: actualShare.email,
      accessKey: actualShare.accessKey,
      secretKey: actualShare.secretKey,
      hasQuota: actualShare.capacity > 0,
      capacity: actualShare.capacity > 0 ? Math.round(actualShare.capacity) : null,
      used: actualShare.used > 0 ? Math.round(actualShare.used) : null,
      status: RadosGatewayShareStatus.up,
      suspended: actualShare.suspended
    };
  }

  /**
   * @param {ClusterModel} cluster
   * @param {Proxy} proxy
   * @param {Array.<string>|null} shareNames
   * @returns {Promise.<Array.<RadosGatewayShareModel>>}
   */
  async updateRadosGatewayShares(cluster, proxy, {shareNames = []} = {}) {
    const updatePartially = (shareNames instanceof Array) && shareNames.length > 0;
    let actualShares = [];

    try {
      actualShares = Object.entries(await proxy.rgw.users({timeout: ExtendedTimeout}))
        .map(([userName, share]) => share);
    }
    catch (err) {
    }
    this._triggerExceptionPoint();

    if (updatePartially) {
      actualShares = actualShares.filter(x => shareNames.indexOf(x.username) >= 0);
    }

    const fn = restified.autocommit(async t => {
      let result = [];

      const shares = updatePartially ?
        (await Promise.all(shareNames.map(async name => {
          return (await cluster.getRadosGatewayShares({
            where: {
              userName: name
            },
            transaction: t
          }))[0];
        }))).filter(x => !!x) : (await cluster.getRadosGatewayShares({transaction: t}));

      for (const actualShare of actualShares) {
        let share = shares.filter(x => x.userName === actualShare.username)[0];

        if (!share) {
          share = await RadosGatewayShare.create(this._createRadosGatewayShareModel(actualShare), {transaction: t});
          await share.setCluster(cluster, {transaction: t});
        }
        else {
          Object.assign(share, this._createRadosGatewayShareModel(actualShare));
          await share.save({transaction: t});
        }

        result.push(share);
      }

      if (!updatePartially) {
        const missingShares = shares.filter(x => !actualShares.some(y => x.userName === y.username));

        for (const missingShare of missingShares) {
          Object.assign(missingShare, {
            status: RadosGatewayShareStatus.missing
          });

          await missingShare.save({transaction: t});
        }
      }

      return result;
    });

    return await fn();
  }

  /**
   * @param {SambaShare} actualShare
   * @param {boolean} suspended
   * @returns {SambaShareModel}
   * @private
   */
  _createSambaShareModel(actualShare, suspended) {
    return {
      name: actualShare.name,
      comment: actualShare.comment,
      browsable: actualShare.browsable,
      guest: SambaAuthUtils.stringifyPermission(actualShare.guest),
      status: SambaStatus.up,
      suspended: suspended
    };
  }

  /**
   * @param {ClusterModel} cluster
   * @param {Proxy} proxy
   * @param {Array.<HostModel>} hosts
   * @param {Array.<string>} shareNames
   * @param {boolean} warnAsError
   * @param {boolean} forceUpdateMissing
   * @returns {Promise.<{
   * hosts: Array.<HostModel>,
   * shares: Array.<SambaShareModel>
   * }>}
   */
  async updateSambaShares(cluster, proxy, hosts,
                          {shareNames = [], warnAsError = false, forceUpdateMissing = false} = {}) {
    const filteredHosts = await (restified.autocommit(async t => {
      return (await Promise.all(hosts.map(async host => {
        const types = host.RpcTypes || (await host.getRpcTypes({transaction: t}));
        host.RpcTypes = types;
        return [host, types.some(type => type.name === 'samba')];
      }))).map(([host, isSamba]) => isSamba ? host : null).filter(host => host !== null);
    }))();

    const updatePartially = (shareNames instanceof Array) && shareNames.length > 0;

    let actualShares = (await Promise.all(filteredHosts.map(async host => {
      try {
        return await proxy.samba.ls(host.hostName, {info: false, timeout: ExtendedTimeout});
      }
      catch (err) {
        host.status = HostStatus.down;
        return [];
      }
    }))).reduce((prev, cur) => prev.concat(cur), []);

    if (updatePartially) {
      actualShares = actualShares.filter(x => shareNames.some(y => x.name === y));
    }

    this._triggerExceptionPoint();

    const deletionList = [];
    const additionList = [];

    const fn = restified.autocommit(async t => {
      const shares = updatePartially ?
        (await Promise.all(shareNames.map(async name => {
          return (await cluster.getSambaShares({
            where: {
              name: name
            },
            limit: 1,
            offset: 0,
            transaction: t
          }))[0];
        }))).filter(share => !!share) : (await cluster.getSambaShares({transaction: t}));

      const result = [];

      for (const actualShare of actualShares) {
        let share = shares.filter(x => x.name === actualShare.name)[0];

        if (!share) {
          share = await SambaShare.create(this._createSambaShareModel(actualShare, false), {transaction: t});
          await share.setCluster(cluster, {transaction: t});
        }
        else {
          Object.assign(share, this._createSambaShareModel(actualShare, share.suspended));
          await share.save({transaction: t});

          if (share.suspended) {
            deletionList.push(actualShare);
          }
        }

        result.push(share);

        let host = await share.getHost({transaction: t});

        if (!host || host.hostName !== actualShare.host) {
          host = (await cluster.getHosts({
            where: {
              hostName: actualShare.host
            },
            limit: 1,
            offset: 0,
            transaction: t
          }))[0];

          if (host) {
            await share.setHost(host, {transaction: t});
            share.Host = host;
          }
        }

        let rbdImage = await share.getRbdImage({transaction: t});

        if (!rbdImage || rbdImage.pool !== actualShare.pool || rbdImage.image !== actualShare.image) {
          rbdImage = (await cluster.getRbdImages({
            where: {
              pool: actualShare.pool,
              image: actualShare.image
            },
            limit: 1,
            offset: 0,
            transaction: t
          }))[0];

          if (rbdImage) {
            await share.setRbdImage(rbdImage, {transaction: t});
            share.RbdImage = rbdImage;
          }
        }

        if (host) {
          const acls = await share.getSambaAcls({
            include: [{
              model: SambaUser
            }],
            transaction: t
          });

          for (const [userName, actualAcl] of Object.entries(actualShare.acl)) {
            let acl = acls.filter(x => x.SambaUser && x.SambaUser.userName === userName)[0];

            let user = (await host.getSambaUsers({
              where: {
                userName: userName
              },
              transaction: t,
              limit: 1,
              offset: 0
            }))[0];

            if (!user) {
              user = await SambaUser.create({
                userName: userName,
                password: actualAcl.password || ''
              }, {transaction: t});

              await host.addSambaUser(user, {transaction: t});
            }
            else {
              Object.assign(user, {password: actualAcl.password || ''});
              await user.save({transaction: t});
            }

            if (!acl) {
              acl = await SambaAcl.create({
                permission: SambaAuthUtils.stringifyPermission(actualAcl.permission)
              }, {transaction: t});

              await acl.setSambaUser(user, {transaction: t});
              await acl.setSambaShare(share, {transaction: t});
            }
            else {
              Object.assign(acl, {
                permission: SambaAuthUtils.stringifyPermission(actualAcl.permission)
              });

              await acl.save({transaction: t});
            }
          }

          const missingAcls = acls.filter(x => !(x.SambaUser.userName in actualShare.acl));

          for (const missingAcl of missingAcls) {
            const user = missingAcl.SambaUser;

            await missingAcl.destroy({transaction: t});
            const count = await user.countSambaAcls({transaction: t});

            if (count < 1) {
              await user.destroy({transaction: t});
            }
          }
        }
      }

      if (!updatePartially || forceUpdateMissing) {
        const missingShares = shares.filter(x => !actualShares.some(y => x.name === y.name));

        for (const missingShare of missingShares) {
          if (!missingShare.suspended) {
            Object.assign(missingShare, {
              status: SambaStatus.missing
            });

            await missingShare.save({transaction: t});

            const host = await missingShare.getHost({transaction: t});
            const rbdImage = await missingShare.getRbdImage({transaction: t});
            const acls = await missingShare.getSambaAcls({
              include: [{
                model: SambaUser
              }],
              transaction: t
            });

            if (host && rbdImage) {
              const share = {
                image: rbdImage.image,
                pool: rbdImage.pool,
                id: 'admin',
                guest: SambaAuthUtils.parsePermission(missingShare.guest),
                acl: acls.map(x => ({
                  [x.SambaUser.userName]: {
                    permission: SambaAuthUtils.parsePermission(x.permission),
                    password: x.SambaUser.password
                  }
                })).reduce((prev, cur) => Object.assign(prev, cur), {}),
                name: missingShare.name,
                comment: missingShare.comment,
                browsable: missingShare.browsable,
                capacity: null,
                used: null,
                host: host.hostName
              };

              additionList.push({
                host: host,
                share: share
              });
            }
          }
        }
      }

      return result;
    });

    const result = await fn();

    for (const actualShare of deletionList) {
      try {
        await proxy.samba.del(actualShare.name, {
          host: actualShare.host,
          timeout: ExtendedTimeout
        });
      }
      catch (err) {
        logger.warn(ErrorFormatter.format(err));

        if (warnAsError) {
          throw err;
        }
      }
    }

    for (const data of additionList) {
      try {
        await proxy.samba.add(data.share, data.host.hostName, {timeout: ExtendedTimeout});

        const updatedShare = await this.updateSambaShares(cluster, proxy, [data.host], {
          shareNames: [data.share.name],
          warnAsError: warnAsError,
          forceUpdateMissing: false
        });

        result.push(updatedShare.shares[0]);
      }
      catch (err) {
        logger.warn(ErrorFormatter.format(err));

        if (warnAsError) {
          throw err;
        }
      }
    }

    return {
      hosts: hosts.filter(host => host.status !== HostStatus.down),
      shares: result
    };
  }

  /**
   * @param {WorkerInfoResponseItem} actualHost
   * @returns {HostModel}
   * @private
   */
  _createHostModel(actualHost) {
    return {
      hostName: actualHost.hostname,
      version: actualHost.version,
      status: HostStatus.up,
      distro_centos: actualHost.distro.centos,
      distro_ubuntu: actualHost.distro.ubuntu,
      distro_version: actualHost.distro.version,
      ipList: JSON.stringify({list: actualHost.ip})
    };
  }

  /**
   * @param {ParsedImageName} name
   * @param {RbdImageInfo} actualImage
   * @param {RbdMountPoint|null} mountPoint
   * @param {RbdImageModel|null} prevModel
   * @returns {RbdImageModel}
   * @private
   */
  _createRbdImageModel(name, actualImage, mountPoint, prevModel) {
    let capacity = 0;
    let used = 0;

    if (prevModel) {
      capacity = prevModel.capacity;
      used = prevModel.used;
    }

    if (actualImage) {
      capacity = Math.round(actualImage.diskSize);
      used = Math.round(actualImage.diskUsed);
    }

    if (mountPoint) {
      capacity = Math.round(mountPoint.diskSize);
      used = Math.round(mountPoint.diskUsed);
    }

    return {
      pool: name.pool,
      image: name.image,
      capacity: capacity,
      used: used,
      fileSystem: mountPoint ? mountPoint.fileSystem : (actualImage ? actualImage.fileSystem : null),
      isMounted: !!mountPoint,
      status: (actualImage || mountPoint) ? RbdImageStatus.up : RbdImageStatus.failed,
      mountPoint_location: mountPoint ? mountPoint.mountPoint : null,
      mountPoint_rbdId: mountPoint ? mountPoint.rbdId : null,
      mountPoint_device: mountPoint ? mountPoint.device : null,
      mountPoint_readOnly: mountPoint ? mountPoint.readOnly : null
    };
  }

  /**
   * @param {ClusterModel} cluster
   * @param {Proxy} proxy
   * @returns {Promise.<Array.<HostModel>>}
   */
  async updateHosts(cluster, proxy) {
    const actualHosts = await proxy.hosts();
    this._triggerExceptionPoint();

    let hosts = [];
    const rpcTypeCache = {};
    let missingHosts = [];

    const updateHost = async (t, actualHost) => {
      let host = hosts.filter(x => x.hostName === actualHost.hostname)[0];

      if (!host) {
        host = await Host.create(this._createHostModel(actualHost), {transaction: t});
        await cluster.addHost(host, {transaction: t});
      }
      else {
        Object.assign(host, this._createHostModel(actualHost));
        await host.save({transaction: t});
      }

      const types = await Promise.all(actualHost.types.map(async type => {
        if (type in rpcTypeCache) {
          return rpcTypeCache[type];
        }

        const [result] = (await RpcType.findOrCreate({
          where: {
            name: type
          },
          defaults: {
            name: type
          },
          transaction: t
        }));

        rpcTypeCache[type] = result;
        return result;
      }));

      await host.setRpcTypes(types, {transaction: t});
      host.RpcTypes = types;
    };

    const fn = restified.autocommit(async t => {
      hosts = await cluster.getHosts({
        transaction: t
      });

      for (const actualHost of actualHosts) {
        await updateHost(t, actualHost);
      }

      missingHosts = hosts.filter(x => !actualHosts.some(y => x.hostName === y.hostname));
    });

    await fn();

    const updateHostsAgain = (await Promise.all(missingHosts.map(async host => {
      try {
        return await proxy.client.getHostInfo(host.hostName, {timeout: ExtendedTimeout});
      }
      catch (err) {
        return null;
      }
    }))).filter(x => x !== null);

    this._triggerExceptionPoint();

    missingHosts = missingHosts.filter(x => !updateHostsAgain.some(y => x.hostName === y.hostname));

    const gn = restified.autocommit(async t => {
      for (const actualHost of updateHostsAgain) {
        await updateHost(t, actualHost);
      }

      for (const host of missingHosts) {
        Object.assign(host, {
          status: HostStatus.down
        });

        await host.save({transaction: t});
      }
    });

    await gn();

    return hosts.filter(x => x.status === HostStatus.up);
  }

  /**
   * @param {ClusterModel} cluster
   * @param {Proxy} proxy
   * @param {Array.<HostModel>} hosts
   * @param {Array.<string>} imageNames
   * @returns {Promise.<{
   * hosts: Array.<HostModel>,
   * images: Array.<RbdImageModel>
   * }>}
   */
  async updateRbdImages(cluster, proxy, hosts, {imageNames = []} = []) {
    const actualMountPoints = (await Promise.all(hosts.map(async host => {
      try {
        return await proxy.rbd.getMapped({host: host.hostName, timeout: ExtendedTimeout});
      }
      catch (err) {
        host.status = HostStatus.down;
        return null;
      }
    }))).filter(x => x !== null).reduce((prev, cur) => prev.concat(cur), []);
    this._triggerExceptionPoint();

    const updatePartially = (imageNames instanceof Array) && imageNames.length > 0;

    const rbdImageNameList = updatePartially ? imageNames :
      await Retry.run(async () => {
        return await proxy.rbd.ls({pool: '*'});
      }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));
    this._triggerExceptionPoint();

    const actualImages = await SequentialAsyncMap.map(rbdImageNameList,
      async name => {
       try {
         const parsedName = ImageNameParser.parse(name);
         const mountPoint = actualMountPoints.filter(x => x.image === parsedName.fullName)[0];

         if (mountPoint) {
           return [name, {
             image: parsedName.fullName,
             size: mountPoint.diskSize,
             diskSize: mountPoint.diskSize,
             diskUsed: mountPoint.diskUsed,
             fileSystem: mountPoint.fileSystem
           }];
         }
         else {
           const targetHost = mountPoint ? mountPoint.hostname : null;
           return [name, await proxy.rbd.info({image: name, host: targetHost, timeout: ExtendedTimeout})];
         }
       }
       catch (err) {
         return [name, null];
       }
      });
    this._triggerExceptionPoint();

    const fn = restified.autocommit(async t => {
      const images = updatePartially ?
        (await Promise.all(imageNames.map(async name => {
          const parsedName = ImageNameParser.parse(name);
          return (await cluster.getRbdImages({
            where: {
              pool: parsedName.pool,
              image: parsedName.image
            },
            transaction: t,
            limit: 1,
            offset: 0
          }))[0];
        }))).filter(x => !!x) : await cluster.getRbdImages({transaction: t});

      let result = [];

      for (const [imageName, actualImage] of actualImages) {
        const name = ImageNameParser.parse(actualImage ? actualImage.image : imageName);
        let image = images.filter(x => x.pool === name.pool && x.image === name.image)[0];
        const mountPoint = actualMountPoints.filter(x => x.image === name.fullName)[0];

        if (!image) {
          image = await RbdImage.create(this._createRbdImageModel(name, actualImage, mountPoint, null), {transaction: t});
          await cluster.addRbdImage(image, {transaction: t});
        }
        else {
          Object.assign(image, this._createRbdImageModel(name, actualImage, mountPoint, image));
          await image.save({transaction: t});
        }

        result.push(image);
        let host = await image.getHost();

        if (host && !mountPoint) {
          await image.setHost(null, {transaction: t});
          image.Host = null;
        }
        else if (!host && mountPoint) {
          host = await Host.findOne({
            where: {
              hostName: mountPoint.hostname
            },
            include: [{
              model: Cluster,
              where: {
                name: cluster.name
              }
            }],
            transaction: t
          });

          if (host) {
            await image.setHost(host, {transaction: t});
            image.Host = host;
          }
        }
      }

      if (!updatePartially) {
        const missingImages = images.filter(x => {
          const name = ImageNameParser.parse(x.image, x.pool);

          return !actualImages.some(([imageName, actualImage]) =>
            ImageNameParser.parse(actualImage ? actualImage.image : imageName).fullName === name.fullName);
        });

        for (const missingImage of missingImages) {
          missingImage.status = RbdImageStatus.missing;
          await missingImage.save({transaction: t});
        }
      }

      return result;
    });

    const result = await fn();

    return {
      hosts: hosts.filter(host => host.status !== HostStatus.down),
      images: result
    };
  }

  /**
   * @returns {string}
   */
  get clusterName() {
    return this._clusterName;
  }

  async run() {
    this._triggerExceptionPoint();

    const cluster = await Cluster.findOne({
      where: {
        name: this._clusterName
      },
      include: [{
        model: Host
      }]
    });

    if (!cluster) {
      throw new Error(`specified cluster not found "${this._clusterName}"`);
    }

    const connectionString =
      `amqp://${cluster.brokerUserName}:${cluster.brokerPassword}@${cluster.brokerHost}?heartbeat=${cluster.brokerHeartBeat}`;
    const client = new ClientLoop(connectionString, cluster.brokerTopic, cluster.brokerTimeout);
    await client.start();

    try {
      const proxy = new Proxy(client);
      this._triggerExceptionPoint();

      let hosts = await this.updateHosts(cluster, proxy);
      this._triggerExceptionPoint();

      let radosGatewayShares = await this.updateRadosGatewayShares(cluster, proxy);
      this._triggerExceptionPoint();

      let result = null;

      result = await this.updateRbdImages(cluster, proxy, hosts);
      this._triggerExceptionPoint();
      hosts = result.hosts;
      let images = result.images;

      result = await this.updateSambaShares(cluster, proxy, hosts);
      this._triggerExceptionPoint();
      hosts = result.hosts;
      let shares = result.shares;

      result = await this.updateScsiHosts(cluster, proxy, hosts);
      this._triggerExceptionPoint();
      hosts = result.hosts;
      let scsiHosts = result.scsiHosts;

      result = await this.updateScsiTargets(cluster, proxy, hosts);
      this._triggerExceptionPoint();
      hosts = result.hosts;
      let targets = result.targets;
    }
    finally {
      await client.stop();
    }
  }
}

module.exports = ClusterUpdater;
