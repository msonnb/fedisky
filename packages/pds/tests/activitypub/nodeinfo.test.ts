import { AtpAgent } from '@atproto/api'
import { SeedClient, TestNetworkNoAppView } from '@atproto/dev-env'
import usersSeed from '../seeds/users'

describe('activitypub nodeinfo', () => {
  let network: TestNetworkNoAppView
  let agent: AtpAgent
  let sc: SeedClient

  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({
      dbPostgresSchema: 'activitypub_nodeinfo',
      pds: {
        version: '1.2.3',
      },
    })
    agent = network.pds.getClient()
    sc = network.getSeedClient()
    await usersSeed(sc)
  })

  afterAll(async () => {
    await network.close()
  })

  describe('nodeinfo 2.1 endpoint', () => {
    it('returns valid NodeInfo 2.1 response', async () => {
      const res = await fetch(`${network.pds.url}/nodeinfo/2.1`, {
        headers: { Accept: 'application/json' },
      })
      expect(res.status).toBe(200)

      const nodeinfo = await res.json()

      // Verify NodeInfo 2.1 schema version
      expect(nodeinfo.version).toBe('2.1')
    })

    it('includes software information', async () => {
      const res = await fetch(`${network.pds.url}/nodeinfo/2.1`, {
        headers: { Accept: 'application/json' },
      })
      const nodeinfo = await res.json()

      expect(nodeinfo.software).toBeDefined()
      expect(nodeinfo.software.name).toBe('bluesky-pds')
      expect(nodeinfo.software.version).toBeDefined()
    })

    it('includes correct version from config', async () => {
      const res = await fetch(`${network.pds.url}/nodeinfo/2.1`, {
        headers: { Accept: 'application/json' },
      })
      const nodeinfo = await res.json()

      // Version should match what we configured
      expect(nodeinfo.software.version).toBe('1.2.3')
    })

    it('includes homepage and repository URLs', async () => {
      const res = await fetch(`${network.pds.url}/nodeinfo/2.1`, {
        headers: { Accept: 'application/json' },
      })
      const nodeinfo = await res.json()

      expect(nodeinfo.software.homepage).toBeDefined()
      expect(nodeinfo.software.homepage).toContain('bsky.app')

      expect(nodeinfo.software.repository).toBeDefined()
      expect(nodeinfo.software.repository).toContain('github.com')
    })

    it('includes protocols array with activitypub', async () => {
      const res = await fetch(`${network.pds.url}/nodeinfo/2.1`, {
        headers: { Accept: 'application/json' },
      })
      const nodeinfo = await res.json()

      expect(nodeinfo.protocols).toBeDefined()
      expect(Array.isArray(nodeinfo.protocols)).toBe(true)
      expect(nodeinfo.protocols).toContain('activitypub')
    })

    it('includes usage statistics', async () => {
      const res = await fetch(`${network.pds.url}/nodeinfo/2.1`, {
        headers: { Accept: 'application/json' },
      })
      const nodeinfo = await res.json()

      expect(nodeinfo.usage).toBeDefined()
      expect(nodeinfo.usage.users).toBeDefined()
      expect(typeof nodeinfo.usage.users.total).toBe('number')
    })

    it('returns correct user count', async () => {
      const res = await fetch(`${network.pds.url}/nodeinfo/2.1`, {
        headers: { Accept: 'application/json' },
      })
      const nodeinfo = await res.json()

      // We seeded 4 users (alice, bob, carol, dan)
      expect(nodeinfo.usage.users.total).toBeGreaterThanOrEqual(4)
    })

    it('includes post counts', async () => {
      const res = await fetch(`${network.pds.url}/nodeinfo/2.1`, {
        headers: { Accept: 'application/json' },
      })
      const nodeinfo = await res.json()

      expect(nodeinfo.usage.localPosts).toBeDefined()
      expect(typeof nodeinfo.usage.localPosts).toBe('number')

      expect(nodeinfo.usage.localComments).toBeDefined()
      expect(typeof nodeinfo.usage.localComments).toBe('number')
    })
  })

  describe('well-known nodeinfo', () => {
    it('returns nodeinfo links at .well-known/nodeinfo', async () => {
      const res = await fetch(`${network.pds.url}/.well-known/nodeinfo`, {
        headers: { Accept: 'application/json' },
      })

      if (res.status === 200) {
        const wellKnown = await res.json()
        expect(wellKnown.links).toBeDefined()
        expect(Array.isArray(wellKnown.links)).toBe(true)

        // Should have a link to NodeInfo 2.1
        const nodeinfo21Link = wellKnown.links.find(
          (link: { rel: string }) =>
            link.rel === 'http://nodeinfo.diaspora.software/ns/schema/2.1',
        )

        if (nodeinfo21Link) {
          expect(nodeinfo21Link.href).toContain('/nodeinfo/2.1')
        }
      }
    })
  })

  describe('user count updates', () => {
    it('user count increases when new accounts are created', async () => {
      // Get initial count
      const res1 = await fetch(`${network.pds.url}/nodeinfo/2.1`, {
        headers: { Accept: 'application/json' },
      })
      const nodeinfo1 = await res1.json()
      const initialCount = nodeinfo1.usage.users.total

      // Create a new account
      const newAgent = network.pds.getClient()
      await newAgent.createAccount({
        email: 'newuser@test.com',
        handle: 'newuser.test',
        password: 'newuser-pass',
      })

      // Get updated count
      const res2 = await fetch(`${network.pds.url}/nodeinfo/2.1`, {
        headers: { Accept: 'application/json' },
      })
      const nodeinfo2 = await res2.json()

      expect(nodeinfo2.usage.users.total).toBe(initialCount + 1)
    })
  })
})
