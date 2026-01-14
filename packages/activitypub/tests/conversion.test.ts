import {
  parseHtmlContent,
  extractLanguage,
} from '../src/conversion/util/html-parser'
import { postConverter } from '../src/conversion/post'
import { createFederation } from '@fedify/testing'
import { LanguageString, Note, Document } from '@fedify/fedify'
import { Temporal } from '@js-temporal/polyfill'
import { createMockPdsClient, testData } from './_setup'
import type { Main as Post } from '@atproto/api/dist/client/types/app/bsky/feed/post'

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

  describe('parseHtmlContent facets', () => {
    it('should create facets for links with correct byte offsets', () => {
      const result = parseHtmlContent(
        '<p>Visit <a href="https://example.com">example.com</a> today</p>',
      )
      expect(result.text).toBe('Visit example.com today')
      expect(result.facets).toHaveLength(1)
      expect(result.facets[0].features[0]).toMatchObject({
        $type: 'app.bsky.richtext.facet#link',
        uri: 'https://example.com',
      })
    })

    it('should handle multiple links', () => {
      const result = parseHtmlContent(
        '<p><a href="https://a.com">first</a> and <a href="https://b.com">second</a></p>',
      )
      expect(result.text).toBe('first and second')
      expect(result.facets).toHaveLength(2)
      expect(result.facets[0].features[0]).toMatchObject({
        uri: 'https://a.com',
      })
      expect(result.facets[1].features[0]).toMatchObject({
        uri: 'https://b.com',
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
        ctx,
        testData.users.alice.did,
        record,
        pdsClient,
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
        ctx,
        testData.users.alice.did,
        record,
        pdsClient,
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
        ctx,
        testData.users.bob.did,
        record,
        pdsClient,
      )

      expect(result).toBeDefined()
      const note = result!.object as Note
      expect(note.replyTargetId).toBeDefined()
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
        ctx,
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
        ctx,
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
        ctx,
        testData.users.alice.did,
        note,
      )

      expect(result).not.toBeNull()
      expect(Buffer.byteLength(result!.value.text, 'utf8')).toBeLessThanOrEqual(
        3000,
      )
      expect(result!.value.text).toMatch(/\.\.\.$/i)
    })

    it('should extract language from LanguageString content', async () => {
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
        ctx,
        testData.users.alice.did,
        note,
      )

      expect(result).not.toBeNull()
      expect(result!.value.text).toBe('Bonjour le monde!')
      expect(result!.value.langs).toEqual(['fr'])
    })
  })
})
