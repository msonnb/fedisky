'use strict';
const {
  APFederationService,
  envToConfig,
  readEnv,
  logger,
} = require('@msonnb/fedisky');
const pkg = require('@msonnb/fedisky/package.json');

const main = async () => {
  const env = readEnv();
  env.version ??= pkg.version;
  const cfg = envToConfig(env);
  const apService = await APFederationService.create(cfg);
  await apService.start();
  logger.info('AP Federation Service has started');
  // Graceful shutdown (see also https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/)
  process.on('SIGTERM', async () => {
    logger.info('AP Federation Service is stopping');
    await apService.destroy();
    logger.info('AP Federation Service is stopped');
  });
};

main();
