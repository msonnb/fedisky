import type { Main as Post } from '@atproto/api/dist/client/types/app/bsky/feed/post'
import type { Context } from '@fedify/fedify'
import { createFederation } from '@fedify/testing'
import { Mention, Note, Document } from '@fedify/vocab'
import { LanguageString } from '@fedify/vocab-runtime'
import { Temporal } from '@js-temporal/polyfill'
import { describe, it, expect } from 'vitest'
import type { PDSClient } from '../../pds-client'
import { createMockPdsClient, createTestDb, testData } from '../../test-utils'
import { postConverter } from '../post'
import { parseHtmlContent, extractLanguage } from '../util/html-parser'

describe('html-parser', () => {
  describe('parseHtmlContent', () => {
    it('should convert simple HTML to plain text', () => {
      const result = parseHtmlContent('<p>Hello world</p>')
      expect(result.text).toBe('Hello world')
    })

    it('should preserve paragraph breaks', () => {
      const result = parseHtmlContent(
        '<p>First paragraph</p><p>Second paragraph</p>',
      )
      expect(result.text).toContain('First paragraph')
      expect(result.text).toContain('Second paragraph')
    })

    it('should strip links but keep text', () => {
      const result = parseHtmlContent(
        '<p>Check out <a href="https://example.com">this link</a></p>',
      )
      expect(result.text).toBe('Check out this link')
      expect(result.text).not.toContain('https://example.com')
    })

    it('should handle empty content', () => {
      const result = parseHtmlContent('')
      expect(result.text).toBe('')
    })

    it('should include language if provided', () => {
      const result = parseHtmlContent('<p>Bonjour</p>', 'fr')
      expect(result.langs).toEqual(['fr'])
    })
  })

  describe('extractLanguage', () => {
    it('should handle plain string content', () => {
      const result = extractLanguage('Hello world')
      expect(result.text).toBe('Hello world')
      expect(result.language).toBeUndefined()
    })

    it('should extract language from LanguageString', () => {
      const langString = new LanguageString('Bonjour', 'fr')
      const result = extractLanguage(langString)
      expect(result.text).toBe('Bonjour')
      expect(result.language).toBe('fr')
    })
  })

  describe('parseHtmlContent links', () => {
    it('should collect links with href and text content', () => {
      const result = parseHtmlContent(
        '<p>Visit <a href="https://example.com">example.com</a> today</p>',
      )
      expect(result.text).toBe('Visit example.com today')
      expect(result.links).toHaveLength(1)
      expect(result.links[0]).toMatchObject({
        href: 'https://example.com',
        textContent: 'example.com',
        isMention: false,
      })
    })

    it('should handle multiple links', () => {
      const result = parseHtmlContent(
        '<p><a href="https://a.com">first</a> and <a href="https://b.com">second</a></p>',
      )
      expect(result.text).toBe('first and second')
      expect(result.links).toHaveLength(2)
      expect(result.links[0]).toMatchObject({
        href: 'https://a.com',
        isMention: false,
      })
      expect(result.links[1]).toMatchObject({
        href: 'https://b.com',
        isMention: false,
      })
    })

    it('should detect mention links with class="mention"', () => {
      const result = parseHtmlContent(
        '<p>Hello <a href="https://ap.example/users/did:plc:abc123" class="mention">@alice</a>!</p>',
      )
      expect(result.text).toBe('Hello @alice!')
      expect(result.links).toHaveLength(1)
      expect(result.links[0]).toMatchObject({
        href: 'https://ap.example/users/did:plc:abc123',
        textContent: '@alice',
        isMention: true,
      })
    })

    it('should detect Mastodon-style mentions with u-url class', () => {
      const result = parseHtmlContent(
        '<p><span class="h-card"><a href="https://ap.example/users/did:plc:xyz" class="u-url mention">@<span>bob</span></a></span> check this out</p>',
      )
      expect(result.text).toBe('@bob check this out')
      expect(result.links).toHaveLength(1)
      expect(result.links[0]).toMatchObject({
        href: 'https://ap.example/users/did:plc:xyz',
        textContent: '@bob',
        isMention: true,
      })
    })

    it('should handle multiple mentions', () => {
      const result = parseHtmlContent(
        '<p><a href="https://ap.example/users/did:plc:aaa" class="mention">@alice</a> and <a href="https://ap.example/users/did:plc:bbb" class="mention">@bob</a></p>',
      )
      expect(result.text).toBe('@alice and @bob')
      const mentions = result.links.filter((l) => l.isMention)
      expect(mentions).toHaveLength(2)
      expect(mentions[0].textContent).toBe('@alice')
      expect(mentions[1].textContent).toBe('@bob')
    })

    it('should distinguish mentions from regular links', () => {
      const result = parseHtmlContent(
        '<p><a href="https://ap.example/users/did:plc:abc" class="mention">@alice</a> shared <a href="https://example.com">this link</a></p>',
      )
      expect(result.links).toHaveLength(2)

      const mentions = result.links.filter((l) => l.isMention)
      const regularLinks = result.links.filter((l) => !l.isMention)

      expect(mentions).toHaveLength(1)
      expect(mentions[0].textContent).toBe('@alice')

      expect(regularLinks).toHaveLength(1)
      expect(regularLinks[0]).toMatchObject({
        href: 'https://example.com',
        textContent: 'this link',
      })
    })
  })
})

describe('postConverter', () => {
  describe('toActivityPub', () => {
    it('should convert a simple text post to a Note', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )
      const pdsClient = createMockPdsClient()

      const record = {
        uri: testData.posts.simple.uri,
        cid: testData.posts.simple.cid,
        value: testData.posts.simple.value as Post,
      }

      const result = await postConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      expect(result!.object).toBeInstanceOf(Note)
      expect(result!.activity).toBeDefined()

      // Check the Note has proper content
      const note = result!.object as Note
      expect(note.id).toBeDefined()
      expect(note.attributionId).toBeDefined()
    })

    it('should convert a post with images to a Note with attachments', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )
      const pdsClient = createMockPdsClient()

      const record = {
        uri: testData.posts.withImages.uri,
        cid: testData.posts.withImages.cid,
        value: testData.posts.withImages.value as Post,
      }

      const result = await postConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      expect(result!.object).toBeInstanceOf(Note)

      // Verify attachments were created
      const note = result!.object as Note
      const attachments: Document[] = []
      for await (const att of note.getAttachments()) {
        attachments.push(att as Document)
      }
      expect(attachments.length).toBeGreaterThan(0)
      expect(attachments[0]).toBeInstanceOf(Document)
    })

    it('should set replyTarget for reply posts', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )
      const pdsClient = createMockPdsClient()

      const record = {
        uri: testData.posts.reply.uri,
        cid: testData.posts.reply.cid,
        value: testData.posts.reply.value as Post,
      }

      const result = await postConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const note = result!.object as Note
      expect(note.replyTargetId).toBeDefined()
    })

    it('should use original AP note ID as replyTarget when post mapping exists', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )
      const pdsClient = createMockPdsClient()
      const db = await createTestDb()

      const bridgePostUri = 'at://did:plc:bridge/app.bsky.feed.post/bridged123'
      const originalApNoteId =
        'https://mastodon.social/users/alice/statuses/987654'
      await db.createPostMapping({
        atUri: bridgePostUri,
        apNoteId: originalApNoteId,
        apActorId: 'https://mastodon.social/users/alice',
        apActorInbox: 'https://mastodon.social/users/alice/inbox',
        createdAt: new Date().toISOString(),
      })

      const replyRecord = {
        uri: 'at://did:plc:bob456/app.bsky.feed.post/replyxyz',
        cid: 'bafyreireplyxyz',
        value: {
          $type: 'app.bsky.feed.post',
          text: 'Replying to a bridged post!',
          createdAt: '2024-01-15T14:00:00.000Z',
          reply: {
            root: { uri: bridgePostUri, cid: 'bafybridged123' },
            parent: { uri: bridgePostUri, cid: 'bafybridged123' },
          },
        } as Post,
      }

      const result = await postConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        replyRecord,
        pdsClient as unknown as PDSClient,
        { db },
      )

      expect(result).toBeDefined()
      const note = result!.object as Note
      expect(note.replyTargetId).toBeDefined()
      // The replyTarget should be the original Mastodon note ID, not our local object URL
      expect(note.replyTargetId?.href).toBe(originalApNoteId)

      await db.close()
    })

    it('should use local object URL as replyTarget when no post mapping exists', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )
      const pdsClient = createMockPdsClient()
      const db = await createTestDb()

      const record = {
        uri: testData.posts.reply.uri,
        cid: testData.posts.reply.cid,
        value: testData.posts.reply.value as Post,
      }

      const result = await postConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        record,
        pdsClient as unknown as PDSClient,
        { db },
      )

      expect(result).toBeDefined()
      const note = result!.object as Note
      expect(note.replyTargetId).toBeDefined()
      // Should use local object URL format since there's no mapping
      expect(note.replyTargetId?.href).toContain('https://ap.example/posts/')

      await db.close()
    })
  })

  describe('toRecord', () => {
    it('should convert a simple Note to a post record', async () => {
      const federation = createFederation<void>()
      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const note = new Note({
        id: new URL('https://remote.example/notes/123'),
        content: '<p>Hello from the fediverse!</p>',
        published: Temporal.Now.instant(),
      })

      const result = await postConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        note,
      )

      expect(result).not.toBeNull()
      expect(result!.value.text).toBe('Hello from the fediverse!')
      expect(result!.value.$type).toBe('app.bsky.feed.post')
      expect(result!.uri).toContain(testData.users.alice.did)
    })

    it('should return null for Note with no content', async () => {
      const federation = createFederation<void>()
      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const note = new Note({
        id: new URL('https://remote.example/notes/empty'),
      })

      const result = await postConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        note,
      )

      expect(result).toBeNull()
    })

    it('should truncate text that exceeds byte limit', async () => {
      const federation = createFederation<void>()
      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      // Create a very long string (> 3000 bytes)
      const longText = 'A'.repeat(4000)
      const note = new Note({
        id: new URL('https://remote.example/notes/long'),
        content: `<p>${longText}</p>`,
        published: Temporal.Now.instant(),
      })

      const result = await postConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        note,
      )

      expect(result).not.toBeNull()
      expect(Buffer.byteLength(result!.value.text, 'utf8')).toBeLessThanOrEqual(
        3000,
      )
      expect(result!.value.text).toMatch(/\.\.\.$/i)
    })

    // TODO: class mismatch between @fedify/vocab and @fedify/vocab-runtime
    it.skip('should extract language from LanguageString content', async () => {
      const federation = createFederation<void>()
      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const note = new Note({
        id: new URL('https://remote.example/notes/fr'),
        content: new LanguageString('<p>Bonjour le monde!</p>', 'fr'),
        published: Temporal.Now.instant(),
      })

      const result = await postConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        note,
      )

      expect(result).not.toBeNull()
      expect(result!.value.text).toBe('Bonjour le monde!')
      expect(result!.value.langs).toEqual(['fr'])
    })

    it('should convert AP mentions to ATProto mention facets for local users', async () => {
      const federation = createFederation<void>()
      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      // Mock pdsClient to return account for local user
      const pdsClient = createMockPdsClient({
        getAccount: async (did: string) => {
          if (did === testData.users.alice.did) {
            return { did, handle: testData.users.alice.handle } as any
          }
          return null
        },
      })

      const note = new Note({
        id: new URL('https://remote.example/notes/mention1'),
        content: `<p>Hey <a href="https://ap.example/users/${testData.users.alice.did}" class="mention">@alice</a> check this out!</p>`,
        published: Temporal.Now.instant(),
      })

      const result = await postConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        note,
        { pdsClient: pdsClient as unknown as PDSClient },
      )

      expect(result).not.toBeNull()
      expect(result!.value.text).toBe('Hey @alice check this out!')
      expect(result!.value.facets).toBeDefined()
      expect(result!.value.facets).toHaveLength(1)
      expect(result!.value.facets![0].features[0]).toMatchObject({
        $type: 'app.bsky.richtext.facet#mention',
        did: testData.users.alice.did,
      })
    })

    it('should not create mention facets for non-local users', async () => {
      const federation = createFederation<void>()
      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      // Mock pdsClient to return null (user not found locally)
      const pdsClient = createMockPdsClient({
        getAccount: async () => null,
      })

      const note = new Note({
        id: new URL('https://remote.example/notes/mention2'),
        content: `<p>Hey <a href="https://ap.example/users/did:plc:external" class="mention">@external</a> check this out!</p>`,
        published: Temporal.Now.instant(),
      })

      const result = await postConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        note,
        { pdsClient: pdsClient as unknown as PDSClient },
      )

      expect(result).not.toBeNull()
      expect(result!.value.text).toBe('Hey @external check this out!')
      // No facets should be created for non-local users
      expect(result!.value.facets).toBeUndefined()
    })
  })

  describe('toActivityPub mentions', () => {
    it('should convert ATProto mention facets to ActivityPub Mention tags', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      // Mock pdsClient to return account for mentioned local user
      const pdsClient = createMockPdsClient({
        getAccount: async (did: string) => {
          if (did === testData.users.bob.did) {
            return { did, handle: testData.users.bob.handle } as any
          }
          return null
        },
      })

      const postWithMention: Post = {
        $type: 'app.bsky.feed.post',
        text: 'Hello @bob!',
        createdAt: '2024-01-15T12:00:00.000Z',
        facets: [
          {
            index: { byteStart: 6, byteEnd: 10 },
            features: [
              {
                $type: 'app.bsky.richtext.facet#mention',
                did: testData.users.bob.did,
              },
            ],
          },
        ],
      }

      const record = {
        uri: 'at://did:plc:alice123/app.bsky.feed.post/mentionpost',
        cid: 'bafyreimentionpost',
        value: postWithMention,
      }

      const result = await postConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const note = result!.object as Note

      // Check that Mention tags were created
      const tags: Mention[] = []
      for await (const tag of note.getTags()) {
        if (tag instanceof Mention) {
          tags.push(tag)
        }
      }
      expect(tags).toHaveLength(1)
      expect(tags[0].href?.href).toContain(testData.users.bob.did)
      expect(tags[0].name?.toString()).toBe('@bob')
    })

    it('should not include Mention tags for non-local mentioned users', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      // Mock pdsClient to return null (user not local)
      const pdsClient = createMockPdsClient({
        getAccount: async () => null,
      })

      const postWithMention: Post = {
        $type: 'app.bsky.feed.post',
        text: 'Hello @external!',
        createdAt: '2024-01-15T12:00:00.000Z',
        facets: [
          {
            index: { byteStart: 6, byteEnd: 15 },
            features: [
              {
                $type: 'app.bsky.richtext.facet#mention',
                did: 'did:plc:externaluser',
              },
            ],
          },
        ],
      }

      const record = {
        uri: 'at://did:plc:alice123/app.bsky.feed.post/extmention',
        cid: 'bafyreiextmention',
        value: postWithMention,
      }

      const result = await postConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const note = result!.object as Note

      // No Mention tags should be created for non-local users
      const tags: Mention[] = []
      for await (const tag of note.getTags()) {
        if (tag instanceof Mention) {
          tags.push(tag)
        }
      }
      expect(tags).toHaveLength(0)
    })
  })

  describe('content warnings / self-labels', () => {
    it('should convert post with sexual label to Note with summary and sensitive', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )
      const pdsClient = createMockPdsClient()

      const postWithLabel: Post = {
        $type: 'app.bsky.feed.post',
        text: 'This is sensitive content',
        createdAt: '2024-01-15T12:00:00.000Z',
        labels: {
          $type: 'com.atproto.label.defs#selfLabels',
          values: [{ val: 'sexual' }],
        },
      }

      const record = {
        uri: 'at://did:plc:alice123/app.bsky.feed.post/labeledpost',
        cid: 'bafyreilabeledpost',
        value: postWithLabel,
      }

      const result = await postConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const note = result!.object as Note
      expect(note.sensitive).toBe(true)
      expect(note.summary?.toString()).toBe('Sexual Content')
    })

    it('should convert post with multiple labels to combined summary', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )
      const pdsClient = createMockPdsClient()

      const postWithLabels: Post = {
        $type: 'app.bsky.feed.post',
        text: 'Multiple content warnings',
        createdAt: '2024-01-15T12:00:00.000Z',
        labels: {
          $type: 'com.atproto.label.defs#selfLabels',
          values: [{ val: 'nudity' }, { val: 'graphic-media' }],
        },
      }

      const record = {
        uri: 'at://did:plc:alice123/app.bsky.feed.post/multilabel',
        cid: 'bafyreimultilabel',
        value: postWithLabels,
      }

      const result = await postConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const note = result!.object as Note
      expect(note.sensitive).toBe(true)
      expect(note.summary?.toString()).toBe(
        'Nudity, Graphic Media (Violence/Gore)',
      )
    })

    it('should not set sensitive for post without labels', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )
      const pdsClient = createMockPdsClient()

      const record = {
        uri: testData.posts.simple.uri,
        cid: testData.posts.simple.cid,
        value: testData.posts.simple.value as Post,
      }

      const result = await postConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const note = result!.object as Note
      // Fedify returns null for unset properties
      expect(note.sensitive).toBeFalsy()
      expect(note.summary).toBeFalsy()
    })

    it('should convert Note with NSFW summary to post with sexual label', async () => {
      const federation = createFederation<void>()
      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const note = new Note({
        id: new URL('https://remote.example/notes/nsfw'),
        content: '<p>Some adult content</p>',
        summary: 'NSFW',
        sensitive: true,
        published: Temporal.Now.instant(),
      })

      const result = await postConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        note,
      )

      expect(result).not.toBeNull()
      expect(result!.value.labels).toBeDefined()
      expect(result!.value.labels).toEqual({
        $type: 'com.atproto.label.defs#selfLabels',
        values: [{ $type: 'com.atproto.label.defs#selfLabel', val: 'sexual' }],
      })
    })

    it('should convert Note with nudity CW to post with nudity label', async () => {
      const federation = createFederation<void>()
      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const note = new Note({
        id: new URL('https://remote.example/notes/nude'),
        content: '<p>Art with nudity</p>',
        summary: 'CW: nudity',
        sensitive: true,
        published: Temporal.Now.instant(),
      })

      const result = await postConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        note,
      )

      expect(result).not.toBeNull()
      expect(result!.value.labels).toBeDefined()
      expect(result!.value.labels).toEqual({
        $type: 'com.atproto.label.defs#selfLabels',
        values: [{ $type: 'com.atproto.label.defs#selfLabel', val: 'nudity' }],
      })
    })

    it('should default to sexual label when sensitive=true but no keyword match', async () => {
      const federation = createFederation<void>()
      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const note = new Note({
        id: new URL('https://remote.example/notes/sensitive'),
        content: '<p>Something marked sensitive</p>',
        summary: 'spoiler alert',
        sensitive: true,
        published: Temporal.Now.instant(),
      })

      const result = await postConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        note,
      )

      expect(result).not.toBeNull()
      expect(result!.value.labels).toEqual({
        $type: 'com.atproto.label.defs#selfLabels',
        values: [{ $type: 'com.atproto.label.defs#selfLabel', val: 'sexual' }],
      })
    })

    it('should not add labels for Note without summary or sensitive flag', async () => {
      const federation = createFederation<void>()
      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const note = new Note({
        id: new URL('https://remote.example/notes/plain'),
        content: '<p>Just a normal post</p>',
        published: Temporal.Now.instant(),
      })

      const result = await postConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        note,
      )

      expect(result).not.toBeNull()
      expect(result!.value.labels).toBeUndefined()
    })
  })
})
