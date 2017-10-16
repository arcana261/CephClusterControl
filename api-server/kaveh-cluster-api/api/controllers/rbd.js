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
const ClusterUpdater = require('../service/ClusterUpdater');
const HostStatus = require('../const/HostStatus');

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
  const host = !image.isMounted ? null : (image.Host || await image.getHost({transaction: t}));

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

  let host = null;

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

    host = await image.getHost({transaction: t});
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      const parsedName = ImageNameParser.parse(imageName, pool);

      await proxy.rbd.extend({
        image: imageName,
        pool: pool,
        size: size,
        timeout: ClusterUpdater.ExtendedTimeoutValue,
        host: host ? [host.hostName] : []
      });

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateRbdImages(cluster, proxy, host ? [host] : [],
        {imageNames: [parsedName.fullName]});

      const gn = restified.autocommit(async t => {
        return await formatRbdImage(t, result.images[0]);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
}

async function umountRbdImage(req, res) {
  const {
    clusterName: {value: clusterName},
    pool: {value: pool},
    imageName: {value: imageName},
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

  let host = null;

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

    host = await image.getHost({transaction: t});
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      if (host) {
        await proxy.rbd.umount({image: imageName, pool: pool, host: host.hostName, force: force});
      }

      const parsedName = ImageNameParser.parse(imageName, pool);
      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateRbdImages(cluster, proxy, host ? [host] : [],
        {imageNames: [parsedName.fullName]});

      const gn = restified.autocommit(async t => {
        return await formatRbdImage(t, result.images[0]);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
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

  let hostInstance = null;

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

    hostInstance = (await cluster.getHosts({
      where: {
        hostName: host
      },
      offset: 0,
      limit: 1,
      transaction: t
    }))[0];

    if (!hostInstance) {
      throw new except.NotFoundError(`host "${host}" not found in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      await proxy.rbd.mount({image: imageName, pool: pool, host: host, readonly: readOnly, permanent: permanent});
      const parsedName = ImageNameParser.parse(imageName, pool);

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateRbdImages(cluster, proxy, [hostInstance], {imageNames: [parsedName.fullName]});

      const gn = restified.autocommit(async t => {
        return await formatRbdImage(t, result.images[0]);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
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

  let host = null;

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

    host = await image.getHost({transaction: t});
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
    const fn = cluster.autoclose(async proxy => {
      try {
        if (host) {
          await proxy.rbd.umount({
            image: imageName,
            pool: pool,
            host: host.hostName,
            timeout: ClusterUpdater.ExtendedTimeoutValue
          });
        }

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

        return {};
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
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
    const [imageInstance] = await cluster.getRbdImages({
      where: {
        pool: pool,
        image: image
      },
      transaction: t,
      limit: 1,
      offset: 0
    });

    if (imageInstance) {
      throw new except.ConflictError(`rbd image "${pool}/${image}" already exists in cluster "${clusterName}"`);
    }
  });

  await preconditionChecker();

  const result = await Retry.run(async () => {
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

      const parsedName = ImageNameParser.parse(image, pool);

      const updater = new ClusterUpdater(clusterName);
      const result = await updater.updateRbdImages(cluster, proxy, [], {imageNames: [parsedName.fullName]});

      const gn = restified.autocommit(async t => {
        return await formatRbdImage(t, result.images[0]);
      });

      return await gn();
    });

    return await fn();
  }, config.server.retry_wait, config.server.retry, err => logger.warn(ErrorFormatter.format(err)));

  res.json(result);
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
