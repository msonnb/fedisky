/**
 * Mock ActivityPub server for e2e tests
 *
 * A minimal Fedify-based ActivityPub server that can:
 * - Act as remote ActivityPub actors (pre-seeded users)
 * - Receive and store activities for test assertions
 * - Send Follow/Unfollow activities to test federation
 */

import { integrateFederation } from '@fedify/express'
import express from 'express'
import { createApiRouter } from './api'
import { loadConfig } from './config'
import { setupFederation } from './federation'
import { createState } from './state'

async function main() {
  // Log unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[unhandledRejection]', reason)
  })

  const config = loadConfig()
  const state = createState()
  const fedCtx = setupFederation(config, state)

  const app = express()

  // Trust X-Forwarded-* headers from Traefik proxy
  app.set('trust proxy', true)

  // Parse JSON bodies for API routes
  app.use(express.json())

  // Mount test inspection API
  app.use(createApiRouter(config, state, fedCtx))

  // Mount Fedify federation middleware
  app.use(integrateFederation(fedCtx.federation, () => undefined))

  // Error handling middleware
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error('[error] Unhandled error:', err)
      res.status(500).json({ error: 'Internal server error' })
    },
  )

  app.listen(config.port, () => {
    console.log(`Mock AP server running on port ${config.port}`)
    console.log(`Hostname: ${config.hostname}`)
    console.log(`Users: ${config.users.join(', ')}`)
  })
}

main().catch((err) => {
  console.error('Failed to start mock AP server:', err)
  process.exit(1)
})
