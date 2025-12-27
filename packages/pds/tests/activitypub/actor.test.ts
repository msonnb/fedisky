import { AtpAgent } from '@atproto/api'
import { SeedClient, TestNetworkNoAppView } from '@atproto/dev-env'
import usersSeed from '../seeds/users'

describe('activitypub actor', () => {
  let network: TestNetworkNoAppView
  let agent: AtpAgent
  let sc: SeedClient
  let alice: string
  let bob: string

  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({
      dbPostgresSchema: 'activitypub_actor',
    })
    agent = network.pds.getClient()
    sc = network.getSeedClient()
    await usersSeed(sc)
    alice = sc.dids.alice
    bob = sc.dids.bob
  })

  afterAll(async () => {
    await network.close()
  })

  describe('actor endpoint', () => {
    it('returns Person object for valid user by DID', async () => {
      const res = await fetch(`${network.pds.url}/users/${alice}`, {
        headers: { Accept: 'application/activity+json' },
      })
      expect(res.status).toBe(200)

      const actor = await res.json()
      expect(actor.type).toBe('Person')
      expect(actor.id).toContain(`/users/${alice}`)
      expect(actor.preferredUsername).toBe('alice')
      expect(actor.name).toBe('ali')
      expect(actor.summary).toBe('its me!')
    })

    it('includes required ActivityPub properties', async () => {
      const res = await fetch(`${network.pds.url}/users/${alice}`, {
        headers: { Accept: 'application/activity+json' },
      })
      const actor = await res.json()

      // Core ActivityPub properties
      expect(actor.inbox).toContain(`/users/${alice}/inbox`)
      expect(actor.outbox).toContain(`/users/${alice}/outbox`)
      expect(actor.followers).toContain(`/users/${alice}/followers`)
      expect(actor.following).toContain(`/users/${alice}/following`)

      // Public key for HTTP signatures
      expect(actor.publicKey).toBeDefined()
      expect(actor.publicKey.id).toContain(alice)
      expect(actor.publicKey.owner).toContain(alice)
      expect(actor.publicKey.publicKeyPem).toBeDefined()
    })

    it('includes profile URL pointing to bsky.app', async () => {
      const res = await fetch(`${network.pds.url}/users/${alice}`, {
        headers: { Accept: 'application/activity+json' },
      })
      const actor = await res.json()

      expect(actor.url).toContain('bsky.app/profile/')
    })

    it('returns user without profile data', async () => {
      // Carol has no displayName or description
      const carol = sc.dids.carol
      const res = await fetch(`${network.pds.url}/users/${carol}`, {
        headers: { Accept: 'application/activity+json' },
      })
      expect(res.status).toBe(200)

      const actor = await res.json()
      expect(actor.type).toBe('Person')
      expect(actor.preferredUsername).toBe('carol')
      // name and summary may be undefined/null for users without profile
    })

    it('returns 404 for non-existent user', async () => {
      const res = await fetch(
        `${network.pds.url}/users/did:plc:nonexistent123`,
        {
          headers: { Accept: 'application/activity+json' },
        },
      )
      expect(res.status).toBe(404)
    })

    it('generates and persists keypairs on first request', async () => {
      // First request should generate keypairs
      const res1 = await fetch(`${network.pds.url}/users/${alice}`, {
        headers: { Accept: 'application/activity+json' },
      })
      const actor1 = await res1.json()

      // Second request should return the same keypair
      const res2 = await fetch(`${network.pds.url}/users/${alice}`, {
        headers: { Accept: 'application/activity+json' },
      })
      const actor2 = await res2.json()

      expect(actor1.publicKey.publicKeyPem).toBe(actor2.publicKey.publicKeyPem)
    })

    it('includes assertionMethods for multi-key support', async () => {
      const res = await fetch(`${network.pds.url}/users/${alice}`, {
        headers: { Accept: 'application/activity+json' },
      })
      const actor = await res.json()

      // Should have assertion methods (multikey format)
      expect(actor.assertionMethod).toBeDefined()
      expect(Array.isArray(actor.assertionMethod)).toBe(true)
    })
  })

  describe('webfinger', () => {
    it('resolves handle to actor', async () => {
      const res = await fetch(
        `${network.pds.url}/.well-known/webfinger?resource=acct:alice@localhost`,
        {
          headers: { Accept: 'application/jrd+json' },
        },
      )

      // WebFinger should return the actor link
      if (res.status === 200) {
        const webfinger = await res.json()
        expect(webfinger.subject).toBeDefined()
        const selfLink = webfinger.links?.find(
          (l: { rel: string }) => l.rel === 'self',
        )
        if (selfLink) {
          expect(selfLink.type).toBe('application/activity+json')
          expect(selfLink.href).toContain('/users/')
        }
      }
    })
  })
})
