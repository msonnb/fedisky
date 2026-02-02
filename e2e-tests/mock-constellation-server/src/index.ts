/**
 * Mock Constellation + AppView server for e2e tests
 *
 * Provides:
 * - Constellation API endpoints for backlink queries
 * - AppView mock endpoints for fetching external records
 * - Test control API for seeding fake replies
 */

import express from 'express'
import { createApiRouter } from './api'
import { loadConfig } from './config'
import { createState } from './state'

async function main() {
  const config = loadConfig()
  const state = createState()

  const app = express()

  // Trust X-Forwarded-* headers from proxy
  app.set('trust proxy', true)

  // Parse JSON bodies
  app.use(express.json())

  // Mount API router
  app.use(createApiRouter(config, state))

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
    console.log(`Mock Constellation server running on port ${config.port}`)
    console.log(`Hostname: ${config.hostname}`)
  })
}

main().catch((err) => {
  console.error('Failed to start mock Constellation server:', err)
  process.exit(1)
})
