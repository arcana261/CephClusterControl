"use strict";

const restified = require('../helpers/restified');
const {Cluster, RbdImage, Host} = require('../../models');
const except = require('../helpers/except');
const ImageNameParser = require('../../../../lib/utils/ImageNameParser');
const RbdImageStatus = require('../const/RbdImageStatus');
const types = require('../helpers/types');
const logger = require('logging').default('RbdController');
const ErrorFormatter = require('../../../../lib/utils/ErrorFormatter');
const Retry = require('../../../../lib/utils/Retry');
const config = require('../../config');

module.exports = restified.make({
  /**
   * GET /cluster/{clusterName}/rbd
   */
  listRbdImages: listRbdImages,

  /**
   * GET /cluster/{clusterName}/rbd/disk/{pool}/{imageName}
   */
  getRbdImage: getRbdImage,

  /**
   * PUT /cluster/{clusterName}/rbd
   */
  createRbdImage: createRbdImage,

  /**
   * DELETE /cluster/{clusterName}/rbd/disk/{pool}/{imageName}
   */
  deleteRbdImage: deleteRbdImage,

  /**
   * POST /cluster/{clusterName}/rbd/mount/{pool}/{imageName}
   */
  mountRbdImage: mountRbdImage,

  /**
   * DELETE /cluster/{clusterName}/rbd/mount/{pool}/{imageName}
   */
  umountRbdImage: umountRbdImage,

  /**
   * POST /cluster/{clusterName}/rbd/disk/{pool}/{imageName}/extend
   */
  extendRbdImage: extendRbdImage
});

/**
 * @param {*} t
 * @param {RbdImageModel} image
 */
async function formatRbdImage(t, image) {
  const host = !image.isMounted ? null : (await image.getHost({transaction: t}));

  return {
    diskSize: image.capacity || 0,
    image: ImageNameParser.parse(image.image, image.pool).fullName,
    diskUsed: image.used || 0,
    fileSystem: image.fileSystem || 'unknown',
    status: image.status,
    isMounted: image.isMounted,
    mountPoint: !image.isMounted ? {
      location: '',
      rbdId: -1,
      device: '',
      readOnly: false,
      host: ''
    } : {
      location: image.mountPoint_location,
      rbdId: image.mountPoint_rbdId,
      device: image.mountPoint_device,
      readOnly: image.mountPoint_readOnly || false,
      host: !host ? '' : host.hostName
    }
  };
}

async function extendRbdImage(req, res) {
  const {
    clusterName: {value: clusterName},
    pool: {value: pool},
    imageName: {value: imageName},
    extendRequest: {value: {
      size: size
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster not found: "${clusterName}"`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [image] = await cluster.getRbdImages({
      where: {
        pool: pool,
        image: imageName
      },
      offset: 0,
      limit: 1,
      transaction: t
    });

    if (!image) {
      throw new except.NotFoundError(`image "${pool}/${imageName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      const name = ImageNameParser.parse(imageName, pool);
      const mountPoint = (await proxy.rbd.getMapped())
        .filter(x => x.image === name.fullName)[0];

      await proxy.rbd.extend({image: imageName, pool: pool, size: size});
      const info = await proxy.rbd.info({image: imageName, pool: pool, host: mountPoint ? mountPoint.hostname : null});

      const gn = restified.autocommit(async t => {
        const image = await RbdImage.findOne({
          where: {
            image: imageName,
            pool: pool
          },
          include: [{
            model: Cluster,
            where: {
              name: clusterName
            }
          }],
          transaction: t
        });

        if (!image) {
          throw new except.NotFoundError(`image "${pool}/${imageName}" not found in cluster "${clusterName}"`);
        }

        Object.assign(image, {
          capacity: Math.round(info.diskSize || image.capacity),
          used: Math.round(info.diskUsed || image.used)
        });

        await image.save({transaction: t});

        res.json(await formatRbdImage(t, image));
      });

      await gn();
    });

    await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));
}

async function umountRbdImage(req, res) {
  const {
    clusterName: {value: clusterName},
    pool: {value: pool},
    imageName: {value: imageName},
    host: {value: host},
    force: {value: force = false}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster not found: "${clusterName}"`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [image] = await cluster.getRbdImages({
      where: {
        pool: pool,
        image: imageName
      },
      offset: 0,
      limit: 1,
      transaction: t
    });

    if (!image) {
      throw new except.NotFoundError(`image "${pool}/${imageName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.rbd.umount({image: imageName, pool: pool, host: host, force: force});

      const gn = restified.autocommit(async t => {
        const image = await RbdImage.findOne({
          where: {
            pool: pool,
            image: imageName
          },
          include: [{
            model: Cluster,
            where: {
              name: clusterName
            }
          }],
          transaction: t
        });

        if (!image) {
          throw new except.NotFoundError(`image "${pool}/${imageName}" not found in cluster "${clusterName}"`);
        }

        Object.assign(image, {
          isMounted: false,
          mountPoint_location: null,
          mountPoint_rbdId: null,
          mountPoint_device: null,
          mountPoint_readOnly: null
        });

        await image.save({transaction: t});
        await image.setHost(null, {transaction: t});

        res.json(await formatRbdImage(t, image));
      });

      await gn();
    });

    await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));
}

async function mountRbdImage(req, res) {
  const {
    clusterName: {value: clusterName},
    pool: {value: pool},
    imageName: {value: imageName},
    mountRequest: {value: {
      permanent: permanent = false,
      host: host = '',
      readOnly: readOnly = false
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster not found: "${clusterName}"`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [image] = await cluster.getRbdImages({
      where: {
        pool: pool,
        image: imageName
      },
      offset: 0,
      limit: 1,
      transaction: t
    });

    if (!image) {
      throw new except.NotFoundError(`image "${pool}/${imageName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.rbd.mount({image: imageName, pool: pool, host: host, readonly: readOnly, permanent: permanent});
      const name = ImageNameParser.parse(imageName, pool);

      const [mountPoint] = (await proxy.rbd.getMapped())
        .filter(x => x.image === name.fullName);

      const gn = restified.autocommit(async t => {
        const [image] = await cluster.getRbdImages({
          where: {
            image: imageName,
            pool: pool
          },
          limit: 1,
          offset: 0,
          transaction: t
        });

        if (!image) {
          throw new except.NotFoundError(`image "${pool}/${imageName}" not found in cluster "${clusterName}"`);
        }

        if (mountPoint) {
          Object.assign(image, {
            isMounted: true,
            mountPoint_location: mountPoint.mountPoint,
            mountPoint_rbdId: mountPoint.rbdId,
            mountPoint_device: mountPoint.device,
            mountPoint_readOnly: mountPoint.readOnly
          });

          await image.save({transaction: t});

          const hostInstance = await Host.findOne({
            where: {
              hostName: mountPoint.hostname
            },
            include: [{
              model: Cluster,
              where: {
                name: clusterName
              }
            }],
            transaction: t
          });

          if (hostInstance) {
            await image.setHost(hostInstance, {transaction: t});
          }
        }

        res.json(await formatRbdImage(t, image));
      });

      await gn();
    });

    await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));
}

async function deleteRbdImage(req, res) {
  const {
    clusterName: {value: clusterName},
    pool: {value: pool},
    imageName: {value: imageName}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster not found: "${clusterName}"`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [image] = await cluster.getRbdImages({
      where: {
        pool: pool,
        image: imageName
      },
      offset: 0,
      limit: 1,
      transaction: t
    });

    if (!image) {
      throw new except.NotFoundError(`image "${pool}/${imageName}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        await proxy.rbd.umount({image: imageName, pool: pool});
        await proxy.rbd.rm({image: imageName, pool: pool});
      }
      catch (err) {
        if (!types.isString(err) || err.indexOf('No such file or directory') < 0) {
          throw err;
        }
        else {
          logger.warn(ErrorFormatter.format(err));
        }
      }

      const gn = restified.autocommit(async t => {

        const [image] = await cluster.getRbdImages({
          where: {
            pool: pool,
            image: imageName
          },
          offset: 0,
          limit: 1,
          transaction: t
        });

        if (!image) {
          throw new except.NotFoundError(`image "${pool}/${imageName}" not found in cluster "${clusterName}"`);
        }

        await image.destroy({transaction: t});

        res.json({});
      });

      await gn();
    });

    await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));
}

async function createRbdImage(req, res) {
  const {
    clusterName: {value: clusterName},
    pool: {value: pool = req.swagger.params.pool.schema.default},
    image: {value: {
      image: image,
      diskSize: diskSize,
      fileSystem: fileSystem
    }}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    }
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster not found: "${clusterName}"`);
  }

  const preconditionChecker = restified.autocommit(async t => {
    const [image] = cluster.getRbdImages({
      where: {
        pool: pool,
        image: image
      },
      transaction: t,
      limit: 1,
      offset: 0
    });

    if (image) {
      throw new except.ConflictError(`rbd image "${pool}/${image}" already exists in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        await proxy.rbd.create({image: image, pool: pool, size: diskSize, format: fileSystem});
      }
      catch (err) {
        if (types.isString(err) && err.indexOf('File exists') >= 0) {
          throw new except.ConflictError(`rbd image "${pool}/${image}" already exists in cluster "${clusterName}"`);
        }
        else {
          throw err;
        }
      }

      let info = null;

      try {
        info = await proxy.rbd.info({image: image, pool: pool});
      }
      catch (err) {
      }

      const parsedName = ImageNameParser.parse(info.image);

      const gn = restified.autocommit(async t => {
        const rbdImage = await RbdImage.create({
          pool: parsedName.pool,
          image: parsedName.image,
          capacity: info ? info.diskSize || 0 : null,
          used: info ? info.diskUsed || 0 : null,
          fileSystem: info ? info.fileSystem : null,
          isMounted: false,
          status: info ? RbdImageStatus.up : RbdImageStatus.failed,
          mountPoint_location: null,
          mountPoint_rbdId: null,
          mountPoint_device: null,
          mountPoint_readOnly: null
        }, {transaction: t});

        await rbdImage.setCluster(cluster, {transaction: t});

        res.json(await formatRbdImage(t, rbdImage));
      });

      await gn();
    });

    await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));
}

async function getRbdImage(t, req, res) {
  const {
    clusterName: {value: clusterName},
    pool: {value: pool},
    imageName: {value: imageName}
  } = req.swagger.params;

  const image = await RbdImage.findOne({
    where: {
      image: imageName,
      pool: pool
    },
    include: [{
      model: Cluster,
      where: {
        name: clusterName
      }
    }],
    transaction: t
  });

  if (!image) {
    throw new except.NotFoundError(`rbd image "${pool}/${imageName}" not found in cluster "${clusterName}"`);
  }

  res.json(await formatRbdImage(t, image));
}

async function listRbdImages(t, req, res) {
  const {
    clusterName: {value: clusterName},
    start: {value: start = req.swagger.params.start.schema.default},
    length: {value: length = req.swagger.params.length.schema.default},
    pool: {value: pool}
  } = req.swagger.params;

  const cluster = await Cluster.findOne({
    where: {
      name: clusterName
    },
    transaction: t
  });

  if (!cluster) {
    throw new except.NotFoundError(`cluster not found: "${clusterName}"`);
  }

  const images = await cluster.getRbdImages({
    transaction: t,
    limit: length,
    offset: start,
    where: pool ? {
      pool: pool
    } : {}
  });

  res.json({
    result: await Promise.all(images.map(image => formatRbdImage(t, image)))
  });
}
