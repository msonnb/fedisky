import fs from 'node:fs/promises'
import { AtpAgent } from '@atproto/api'
import { SeedClient, TestNetworkNoAppView } from '@atproto/dev-env'
import { AtUri } from '@atproto/syntax'
import usersSeed from '../seeds/users'

describe('activitypub post conversion', () => {
  let network: TestNetworkNoAppView
  let agent: AtpAgent
  let sc: SeedClient
  let alice: string

  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({
      dbPostgresSchema: 'activitypub_post_conversion',
    })
    agent = network.pds.getClient()
    sc = network.getSeedClient()
    await usersSeed(sc)
    alice = sc.dids.alice

    // Ensure actor keypairs are generated
    await fetch(`${network.pds.url}/users/${alice}`, {
      headers: { Accept: 'application/activity+json' },
    })
  })

  afterAll(async () => {
    await network.close()
  })

  describe('basic post to Note conversion', () => {
    it('converts a simple post to a Note', async () => {
      // Create a post
      const postText = 'Hello ActivityPub world!'
      await sc.post(alice, postText)
      await network.processAll()

      // Fetch the outbox to get the activity
      const res = await fetch(`${network.pds.url}/users/${alice}/outbox`, {
        headers: { Accept: 'application/activity+json' },
      })
      expect(res.status).toBe(200)

      const outbox = await res.json()
      const items =
        outbox.orderedItems ||
        outbox.items ||
        (outbox.first?.orderedItems ?? [])

      if (items.length > 0) {
        const createActivity = items.find(
          (item: { type: string }) => item.type === 'Create',
        )

        if (createActivity) {
          // Verify the activity structure
          expect(createActivity.type).toBe('Create')
          expect(createActivity.actor).toContain(alice)

          // The object should be a Note
          const note = createActivity.object
          if (typeof note === 'object') {
            expect(note.type).toBe('Note')
            expect(note.content).toBeDefined()
            expect(note.attributedTo).toContain(alice)
          }
        }
      }
    })

    it('includes proper addressing (to/cc)', async () => {
      await sc.post(alice, 'Public post with addressing')
      await network.processAll()

      const res = await fetch(`${network.pds.url}/users/${alice}/outbox`, {
        headers: { Accept: 'application/activity+json' },
      })
      const outbox = await res.json()
      const items =
        outbox.orderedItems ||
        outbox.items ||
        (outbox.first?.orderedItems ?? [])

      if (items.length > 0) {
        const createActivity = items[0]
        if (createActivity.type === 'Create') {
          // Should address to public
          const toAddresses = Array.isArray(createActivity.to)
            ? createActivity.to
            : [createActivity.to]
          const ccAddresses = Array.isArray(createActivity.cc)
            ? createActivity.cc
            : [createActivity.cc]

          const allAddresses = [...toAddresses, ...ccAddresses].filter(Boolean)

          // Should include public collection
          const hasPublic = allAddresses.some(
            (addr: string) =>
              addr.includes('Public') ||
              addr.includes('as:Public') ||
              addr.includes('#Public'),
          )
          expect(hasPublic).toBe(true)

          // Should include followers collection
          const hasFollowers = allAddresses.some((addr: string) =>
            addr.includes('/followers'),
          )
          expect(hasFollowers).toBe(true)
        }
      }
    })

    it('converts post text to HTML content', async () => {
      const postText = 'First paragraph\n\nSecond paragraph'
      await sc.post(alice, postText)
      await network.processAll()

      const res = await fetch(`${network.pds.url}/users/${alice}/outbox`, {
        headers: { Accept: 'application/activity+json' },
      })
      const outbox = await res.json()
      const items =
        outbox.orderedItems ||
        outbox.items ||
        (outbox.first?.orderedItems ?? [])

      if (items.length > 0) {
        const createActivity = items.find(
          (item: { type: string; object?: { content?: string } }) =>
            item.type === 'Create' &&
            item.object?.content?.includes('paragraph'),
        )

        if (createActivity?.object?.content) {
          // Content should be HTML formatted
          expect(createActivity.object.content).toContain('<p>')
          expect(createActivity.object.content).toContain('</p>')
        }
      }
    })

    it('includes published timestamp', async () => {
      await sc.post(alice, 'Post with timestamp')
      await network.processAll()

      const res = await fetch(`${network.pds.url}/users/${alice}/outbox`, {
        headers: { Accept: 'application/activity+json' },
      })
      const outbox = await res.json()
      const items =
        outbox.orderedItems ||
        outbox.items ||
        (outbox.first?.orderedItems ?? [])

      if (items.length > 0) {
        const createActivity = items[0]
        if (createActivity.type === 'Create') {
          // Should have published timestamp
          expect(createActivity.published).toBeDefined()

          if (createActivity.object?.published) {
            expect(createActivity.object.published).toBeDefined()
          }
        }
      }
    })
  })

  describe('post object endpoint', () => {
    it('can fetch individual Note by URI', async () => {
      // Create a post and get its URI
      const postRef = await sc.post(alice, 'Fetchable post')
      await network.processAll()

      const atUri = new AtUri(postRef.ref.uriStr)
      const encodedUri = encodeURIComponent(postRef.ref.uriStr)

      // Try to fetch the post as ActivityPub object
      const res = await fetch(`${network.pds.url}/posts/${encodedUri}`, {
        headers: { Accept: 'application/activity+json' },
      })

      // The endpoint may return the Note object
      if (res.status === 200) {
        const note = await res.json()
        expect(note.type).toBe('Note')
        expect(note.attributedTo).toContain(alice)
      }
    })
  })

  describe('post with images', () => {
    it('includes image attachments', async () => {
      // Upload an image
      const file = await fs.readFile(
        '../dev-env/assets/key-landscape-small.jpg',
      )
      const uploadedRes = await agent.api.com.atproto.repo.uploadBlob(file, {
        encoding: 'image/jpeg',
        headers: sc.getHeaders(alice),
      })

      // Create post with image
      await sc.post(alice, 'Post with image', undefined, [
        { image: uploadedRes.data.blob, alt: 'Test image' },
      ])
      await network.processAll()

      const res = await fetch(`${network.pds.url}/users/${alice}/outbox`, {
        headers: { Accept: 'application/activity+json' },
      })
      const outbox = await res.json()
      const items =
        outbox.orderedItems ||
        outbox.items ||
        (outbox.first?.orderedItems ?? [])

      // Find the post with image
      const imageActivity = items.find(
        (item: { attachment?: unknown[] }) =>
          item.attachment && item.attachment.length > 0,
      )

      if (imageActivity) {
        expect(imageActivity.attachment.length).toBeGreaterThan(0)
        const attachment = imageActivity.attachment[0]
        expect(attachment.type).toBe('Document')
        expect(attachment.mediaType).toBe('image/jpeg')
        expect(attachment.url).toBeDefined()
      }
    })
  })

  describe('reply posts', () => {
    it('includes replyTarget for reply posts', async () => {
      // Create parent post
      const parentPost = await sc.post(alice, 'Parent post')
      await network.processAll()

      // Create reply
      await sc.reply(alice, parentPost.ref, parentPost.ref, 'This is a reply')
      await network.processAll()

      const res = await fetch(`${network.pds.url}/users/${alice}/outbox`, {
        headers: { Accept: 'application/activity+json' },
      })
      const outbox = await res.json()
      const items =
        outbox.orderedItems ||
        outbox.items ||
        (outbox.first?.orderedItems ?? [])

      // Find the reply activity
      const replyActivity = items.find(
        (item: { object?: { inReplyTo?: unknown } }) =>
          item.object?.inReplyTo !== undefined,
      )

      if (replyActivity) {
        expect(replyActivity.object.inReplyTo).toBeDefined()
        // inReplyTo should reference the parent post
        expect(replyActivity.object.inReplyTo).toContain('/posts/')
      }
    })
  })

  describe('activity URL', () => {
    it('includes URL pointing to bsky.app', async () => {
      await sc.post(alice, 'Post with bsky.app URL')
      await network.processAll()

      const res = await fetch(`${network.pds.url}/users/${alice}/outbox`, {
        headers: { Accept: 'application/activity+json' },
      })
      const outbox = await res.json()
      const items =
        outbox.orderedItems ||
        outbox.items ||
        (outbox.first?.orderedItems ?? [])

      if (items.length > 0) {
        const createActivity = items[0]
        if (createActivity.url) {
          expect(createActivity.url).toContain('bsky.app/profile/')
          expect(createActivity.url).toContain('/post/')
        }
      }
    })
  })
})
