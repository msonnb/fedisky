import { AtpAgent } from '@atproto/api'
import { SeedClient, TestNetworkNoAppView } from '@atproto/dev-env'
import { AppContext } from '../../src/context'
import usersSeed from '../seeds/users'

describe('activitypub inbox', () => {
  let network: TestNetworkNoAppView
  let ctx: AppContext
  let agent: AtpAgent
  let sc: SeedClient
  let alice: string

  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({
      dbPostgresSchema: 'activitypub_inbox',
    })
    // @ts-expect-error Error due to circular dependency with the dev-env package
    ctx = network.pds.ctx
    agent = network.pds.getClient()
    sc = network.getSeedClient()
    await usersSeed(sc)
    alice = sc.dids.alice

    // Request actor to ensure keypairs are generated
    await fetch(`${network.pds.url}/users/${alice}`, {
      headers: { Accept: 'application/activity+json' },
    })
  })

  afterAll(async () => {
    await network.close()
  })

  describe('inbox endpoint', () => {
    it('inbox endpoint exists', async () => {
      const res = await fetch(`${network.pds.url}/users/${alice}/inbox`, {
        method: 'GET',
        headers: { Accept: 'application/activity+json' },
      })
      // Inbox may not support GET, but should return something other than 500
      expect(res.status).not.toBe(500)
    })

    it('shared inbox endpoint exists', async () => {
      const res = await fetch(`${network.pds.url}/inbox`, {
        method: 'GET',
        headers: { Accept: 'application/activity+json' },
      })
      // Shared inbox may not support GET, but should return something other than 500
      expect(res.status).not.toBe(500)
    })
  })

  describe('follow activity storage', () => {
    it('can store and retrieve ActivityPub follows via store', async () => {
      // Directly test the activityPub follow store
      const testFollow = {
        activityId: 'https://remote.example/activities/follow-123',
        actorUri: 'https://remote.example/users/testuser',
        actorInbox: 'https://remote.example/users/testuser/inbox',
        createdAt: new Date().toISOString(),
      }

      // Create a follow
      await ctx.actorStore.transact(alice, async (store) => {
        await store.activityPub.follow.createFollow(testFollow)
      })

      // Retrieve follows
      const { follows } = await ctx.actorStore.read(alice, async (store) => {
        return store.activityPub.follow.getFollows({ cursor: null, limit: 50 })
      })

      expect(follows.length).toBeGreaterThanOrEqual(1)
      const storedFollow = follows.find(
        (f) => f.activityId === testFollow.activityId,
      )
      expect(storedFollow).toBeDefined()
      expect(storedFollow?.actorUri).toBe(testFollow.actorUri)
      expect(storedFollow?.actorInbox).toBe(testFollow.actorInbox)
    })

    it('can delete ActivityPub follows via store', async () => {
      const testFollow = {
        activityId: 'https://remote.example/activities/follow-to-delete',
        actorUri: 'https://remote.example/users/deletableuser',
        actorInbox: 'https://remote.example/users/deletableuser/inbox',
        createdAt: new Date().toISOString(),
      }

      // Create a follow
      await ctx.actorStore.transact(alice, async (store) => {
        await store.activityPub.follow.createFollow(testFollow)
      })

      // Verify it exists
      const { follows: beforeDelete } = await ctx.actorStore.read(
        alice,
        async (store) => {
          return store.activityPub.follow.getFollows({
            cursor: null,
            limit: 50,
          })
        },
      )
      expect(beforeDelete.some((f) => f.actorUri === testFollow.actorUri)).toBe(
        true,
      )

      // Delete the follow
      await ctx.actorStore.transact(alice, async (store) => {
        await store.activityPub.follow.deleteFollow(testFollow.actorUri)
      })

      // Verify it's gone
      const { follows: afterDelete } = await ctx.actorStore.read(
        alice,
        async (store) => {
          return store.activityPub.follow.getFollows({
            cursor: null,
            limit: 50,
          })
        },
      )
      expect(afterDelete.some((f) => f.actorUri === testFollow.actorUri)).toBe(
        false,
      )
    })

    it('can get follows count', async () => {
      // Add a test follow
      const testFollow = {
        activityId: 'https://remote.example/activities/follow-count-test',
        actorUri: 'https://remote.example/users/countuser',
        actorInbox: 'https://remote.example/users/countuser/inbox',
        createdAt: new Date().toISOString(),
      }

      await ctx.actorStore.transact(alice, async (store) => {
        await store.activityPub.follow.createFollow(testFollow)
      })

      const count = await ctx.actorStore.read(alice, async (store) => {
        return store.activityPub.follow.getFollowsCount()
      })

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(1)
    })

    it('handles duplicate follows via upsert', async () => {
      const testFollow = {
        activityId: 'https://remote.example/activities/follow-duplicate',
        actorUri: 'https://remote.example/users/duplicateuser',
        actorInbox: 'https://remote.example/users/duplicateuser/inbox',
        createdAt: new Date().toISOString(),
      }

      // Create first follow
      await ctx.actorStore.transact(alice, async (store) => {
        await store.activityPub.follow.createFollow(testFollow)
      })

      // Create same follow again (should upsert)
      const updatedFollow = {
        ...testFollow,
        actorInbox: 'https://remote.example/users/duplicateuser/inbox-updated',
      }

      await ctx.actorStore.transact(alice, async (store) => {
        await store.activityPub.follow.createFollow(updatedFollow)
      })

      // Should only have one follow with the updated inbox
      const { follows } = await ctx.actorStore.read(alice, async (store) => {
        return store.activityPub.follow.getFollows({ cursor: null, limit: 100 })
      })

      const matchingFollows = follows.filter(
        (f) => f.activityId === testFollow.activityId,
      )
      expect(matchingFollows.length).toBe(1)
      expect(matchingFollows[0].actorInbox).toBe(updatedFollow.actorInbox)
    })

    it('supports pagination for follows', async () => {
      // Use bob for this test to avoid interference from previous tests
      const bob = sc.dids.bob

      // Ensure bob's actor is set up
      await fetch(`${network.pds.url}/users/${bob}`, {
        headers: { Accept: 'application/activity+json' },
      })

      // Add multiple follows to bob
      for (let i = 0; i < 5; i++) {
        await ctx.actorStore.transact(bob, async (store) => {
          await store.activityPub.follow.createFollow({
            activityId: `https://remote.example/activities/bob-pagination-follow-${i}`,
            actorUri: `https://remote.example/users/bobpaginationuser${i}`,
            actorInbox: `https://remote.example/users/bobpaginationuser${i}/inbox`,
            createdAt: new Date(Date.now() + i * 1000).toISOString(),
          })
        })
      }

      // Get first page with limit 2 - note: pagination only applies with cursor
      // First get all to establish a cursor
      const { follows: allFollows } = await ctx.actorStore.read(
        bob,
        async (store) => {
          return store.activityPub.follow.getFollows({
            cursor: null,
            limit: 50,
          })
        },
      )

      expect(allFollows.length).toBeGreaterThanOrEqual(5)

      // Now test pagination using a cursor from the first result
      if (allFollows.length > 2) {
        const cursor = allFollows[1].createdAt // Use second item's createdAt as cursor
        const { follows: page2 } = await ctx.actorStore.read(
          bob,
          async (store) => {
            return store.activityPub.follow.getFollows({
              cursor,
              limit: 2,
            })
          },
        )

        // Should get results after the cursor
        expect(page2.length).toBeLessThanOrEqual(3) // limit+1 for next page detection
        // Results should not include items at or after cursor
        const cursorDate = new Date(cursor)
        for (const follow of page2) {
          expect(new Date(follow.createdAt).getTime()).toBeLessThan(
            cursorDate.getTime(),
          )
        }
      }
    })
  })

  describe('keypair storage', () => {
    it('can store and retrieve keypairs', async () => {
      // Keypairs are auto-generated when fetching actor, verify they exist
      const rsaKeypair = await ctx.actorStore.read(alice, async (store) => {
        return store.activityPub.keyPair.getKeypair('RSASSA-PKCS1-v1_5')
      })

      expect(rsaKeypair).toBeDefined()
      expect(rsaKeypair?.publicKey).toBeDefined()
      expect(rsaKeypair?.privateKey).toBeDefined()
      expect(rsaKeypair?.type).toBe('RSASSA-PKCS1-v1_5')
    })

    it('stores both RSA and Ed25519 keypairs', async () => {
      const keypairs = await ctx.actorStore.read(alice, async (store) => {
        return store.activityPub.keyPair.getKeypairs()
      })

      expect(keypairs.length).toBe(2)

      const types = keypairs.map((k) => k.type)
      expect(types).toContain('RSASSA-PKCS1-v1_5')
      expect(types).toContain('Ed25519')
    })

    it('keypairs are stored as JWK JSON', async () => {
      const rsaKeypair = await ctx.actorStore.read(alice, async (store) => {
        return store.activityPub.keyPair.getKeypair('RSASSA-PKCS1-v1_5')
      })

      expect(rsaKeypair).toBeDefined()

      // Keys should be JSON-parseable JWK
      const publicKey = JSON.parse(rsaKeypair!.publicKey)
      const privateKey = JSON.parse(rsaKeypair!.privateKey)

      expect(publicKey.kty).toBeDefined()
      expect(privateKey.kty).toBeDefined()
    })
  })
})
