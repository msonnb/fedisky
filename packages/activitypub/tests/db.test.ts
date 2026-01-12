import { APDatabase } from '../src/db'

describe('APDatabase', () => {
  let db: APDatabase

  beforeEach(async () => {
    db = new APDatabase(':memory:')
    await db.migrate()
  })

  afterEach(async () => {
    await db.close()
  })

  describe('follows', () => {
    it('should create and retrieve a follow', async () => {
      const follow = {
        userDid: 'did:plc:test123',
        activityId: 'https://mastodon.social/activity/123',
        actorUri: 'https://mastodon.social/users/alice',
        actorInbox: 'https://mastodon.social/users/alice/inbox',
        createdAt: new Date().toISOString(),
      }

      await db.createFollow(follow)

      const { follows } = await db.getFollows({
        userDid: 'did:plc:test123',
        limit: 10,
      })

      expect(follows).toHaveLength(1)
      expect(follows[0].actorUri).toBe(follow.actorUri)
    })

    it('should delete a follow', async () => {
      const follow = {
        userDid: 'did:plc:test123',
        activityId: 'https://mastodon.social/activity/123',
        actorUri: 'https://mastodon.social/users/alice',
        actorInbox: 'https://mastodon.social/users/alice/inbox',
        createdAt: new Date().toISOString(),
      }

      await db.createFollow(follow)
      await db.deleteFollow(
        'did:plc:test123',
        'https://mastodon.social/users/alice',
      )

      const { follows } = await db.getFollows({
        userDid: 'did:plc:test123',
        limit: 10,
      })

      expect(follows).toHaveLength(0)
    })

    it('should count followers', async () => {
      const follow1 = {
        userDid: 'did:plc:test123',
        activityId: 'https://mastodon.social/activity/123',
        actorUri: 'https://mastodon.social/users/alice',
        actorInbox: 'https://mastodon.social/users/alice/inbox',
        createdAt: new Date().toISOString(),
      }
      const follow2 = {
        userDid: 'did:plc:test123',
        activityId: 'https://mastodon.social/activity/124',
        actorUri: 'https://mastodon.social/users/bob',
        actorInbox: 'https://mastodon.social/users/bob/inbox',
        createdAt: new Date().toISOString(),
      }

      await db.createFollow(follow1)
      await db.createFollow(follow2)

      const count = await db.getFollowsCount('did:plc:test123')
      expect(count).toBe(2)
    })
  })

  describe('keypairs', () => {
    it('should create and retrieve a keypair', async () => {
      const keypair = {
        userDid: 'did:plc:test123',
        type: 'RSASSA-PKCS1-v1_5' as const,
        publicKey: '{"test":"public"}',
        privateKey: '{"test":"private"}',
        createdAt: new Date().toISOString(),
      }

      await db.createKeyPair(keypair)

      const retrieved = await db.getKeyPair(
        'did:plc:test123',
        'RSASSA-PKCS1-v1_5',
      )
      expect(retrieved).toBeDefined()
      expect(retrieved?.publicKey).toBe(keypair.publicKey)
    })

    it('should get all keypairs for a user', async () => {
      const rsaKeypair = {
        userDid: 'did:plc:test123',
        type: 'RSASSA-PKCS1-v1_5' as const,
        publicKey: '{"test":"public"}',
        privateKey: '{"test":"private"}',
        createdAt: new Date().toISOString(),
      }
      const ed25519Keypair = {
        userDid: 'did:plc:test123',
        type: 'Ed25519' as const,
        publicKey: '{"test":"public2"}',
        privateKey: '{"test":"private2"}',
        createdAt: new Date().toISOString(),
      }

      await db.createKeyPair(rsaKeypair)
      await db.createKeyPair(ed25519Keypair)

      const keypairs = await db.getKeyPairs('did:plc:test123')
      expect(keypairs).toHaveLength(2)
    })
  })
})
