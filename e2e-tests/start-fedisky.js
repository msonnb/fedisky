#!/usr/bin/env node
const { APFederationService, readEnv, envToConfig } = require('../dist')

async function main() {
  const config = envToConfig(readEnv())
  const service = await APFederationService.create(config)
  await service.start()

  const shutdown = async () => {
    console.log('Shutting down...')
    await service.destroy()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error('Failed to start Fedisky:', err)
  process.exit(1)
})
