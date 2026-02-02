import { beforeAll, afterAll } from 'vitest'
import { FediskyClient } from './clients/fedisky-client'
import { MockAPClient } from './clients/mock-ap-client'
import { MockConstellationClient } from './clients/mock-constellation-client'
import { PDSTestClient } from './clients/pds-client'

// Base URLs for services (via Caddy reverse proxy with TLS)
const BSKY_URL = process.env.E2E_BSKY_URL || 'https://bsky.test'
const MASTODON_URL = process.env.E2E_MASTODON_URL || 'https://mastodon.test'
const CONSTELLATION_URL =
  process.env.E2E_CONSTELLATION_URL || 'http://localhost:3002'

export interface E2EContext {
  pds: PDSTestClient
  fedisky: FediskyClient
  mockAp: MockAPClient
  mockConstellation: MockConstellationClient
}

/**
 * Creates test clients for all E2E services
 */
export function createE2EContext(): E2EContext {
  // PDS and Fedisky share the same hostname (bsky.test) with path-based routing
  // ActivityPub paths go to Fedisky, everything else goes to PDS
  return {
    pds: new PDSTestClient(BSKY_URL),
    fedisky: new FediskyClient(BSKY_URL),
    mockAp: new MockAPClient(MASTODON_URL),
    mockConstellation: new MockConstellationClient(CONSTELLATION_URL),
  }
}

/**
 * Global setup for E2E tests.
 * Waits for all services to be healthy before running tests.
 */
export function setupE2E() {
  let ctx: E2EContext

  beforeAll(async () => {
    ctx = createE2EContext()
    // Reset mock AP state before tests
    await ctx.mockAp.reset()
  }, 120000) // 2 minute timeout for service startup

  afterAll(async () => {
    // Containers are destroyed by the test:e2e script
  })

  return () => ctx
}

/**
 * Generate a unique test identifier to avoid collisions.
 * Uses a short format to keep handles within ATProto length limits.
 */
export function uniqueId(prefix: string = ''): string {
  // Use last 6 digits of timestamp + 4 random chars for uniqueness
  // This keeps the ID short while still being unique enough for tests
  const ts = Date.now().toString().slice(-6)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${prefix}${ts}${rand}`
}
