import type { Main as LikeRecord } from '@atproto/api/dist/client/types/app/bsky/feed/like'
import { Like, Note, PUBLIC_COLLECTION, type Context } from '@fedify/fedify'
import { createFederation } from '@fedify/testing'
import { describe, it, expect, vi } from 'vitest'
import type { PDSClient } from '../../pds-client'
import { createMockPdsClient, testData } from '../../test-utils'
import { likeConverter } from '../like'

describe('likeConverter', () => {
  describe('toActivityPub', () => {
    it('should convert a like of a local post to a Like activity', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockImplementation((did: string) => {
          if (did === testData.users.alice.did) {
            return Promise.resolve({
              did: testData.users.alice.did,
              handle: testData.users.alice.handle,
            })
          }
          return Promise.resolve(null)
        }),
      })

      const record = {
        uri: testData.likes.localLike.uri,
        cid: testData.likes.localLike.cid,
        value: testData.likes.localLike.value as LikeRecord,
      }

      const result = await likeConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      expect(result!.activity).toBeInstanceOf(Like)

      const like = result!.activity as Like
      expect(like.id).toBeDefined()
      expect(like.id?.href).toContain('/likes/')
      expect(like.actorId?.href).toContain(testData.users.bob.did)

      expect(like.objectId).toBeDefined()
      expect(like.objectId?.href).toContain(
        testData.likes.localLike.value.subject.uri,
      )
    })

    it('should return null for likes of external posts', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockResolvedValue(null),
      })

      const record = {
        uri: testData.likes.externalLike.uri,
        cid: testData.likes.externalLike.cid,
        value: testData.likes.externalLike.value as LikeRecord,
      }

      const result = await likeConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeNull()
    })

    it('should include PUBLIC_COLLECTION in to field', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockResolvedValue({
          did: testData.users.alice.did,
          handle: testData.users.alice.handle,
        }),
      })

      const record = {
        uri: testData.likes.localLike.uri,
        cid: testData.likes.localLike.cid,
        value: testData.likes.localLike.value as LikeRecord,
      }

      const result = await likeConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const like = result!.activity as Like

      const toRecipients: string[] = []
      for await (const url of like.toIds!) {
        toRecipients.push(url.href)
      }
      expect(toRecipients).toContain(PUBLIC_COLLECTION.href)
    })

    it('should include followers collection in cc field', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockResolvedValue({
          did: testData.users.alice.did,
          handle: testData.users.alice.handle,
        }),
      })

      const record = {
        uri: testData.likes.localLike.uri,
        cid: testData.likes.localLike.cid,
        value: testData.likes.localLike.value as LikeRecord,
      }

      const result = await likeConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const like = result!.activity as Like

      const ccRecipients: string[] = []
      for await (const url of like.ccIds!) {
        ccRecipients.push(url.href)
      }
      expect(ccRecipients.length).toBeGreaterThan(0)
      expect(ccRecipients[0]).toContain('/followers')
    })

    it('should set correct published timestamp from like createdAt', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockResolvedValue({
          did: testData.users.alice.did,
          handle: testData.users.alice.handle,
        }),
      })

      const record = {
        uri: testData.likes.localLike.uri,
        cid: testData.likes.localLike.cid,
        value: testData.likes.localLike.value as LikeRecord,
      }

      const result = await likeConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const like = result!.activity as Like
      expect(like.published).toBeDefined()
      expect(like.published?.epochMilliseconds).toBe(
        new Date(testData.likes.localLike.value.createdAt).getTime(),
      )
    })
  })

  describe('toRecord', () => {
    it('should return null (Mastodon->Bluesky direction not implemented)', async () => {
      const federation = createFederation<void>()
      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      const note = new Note({
        id: new URL('https://remote.example/notes/123'),
      })

      const result = await likeConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        note,
      )

      expect(result).toBeNull()
    })
  })
})
