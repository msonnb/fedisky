import type { Main as Repost } from '@atproto/api/dist/client/types/app/bsky/feed/repost'
import { Announce, Note, PUBLIC_COLLECTION, type Context } from '@fedify/fedify'
import { createFederation } from '@fedify/testing'
import { describe, it, expect, vi } from 'vitest'
import { repostConverter } from '../../src/conversion/repost'
import type { PDSClient } from '../../src/pds-client'
import { createMockPdsClient, testData } from '../_setup'

describe('repostConverter', () => {
  describe('toActivityPub', () => {
    it('should convert a repost of a local post to an Announce activity', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      // Mock PDS client to return the local user's account (indicating local post)
      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockImplementation((did: string) => {
          // Return account info for alice (local user)
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
        uri: testData.reposts.localRepost.uri,
        cid: testData.reposts.localRepost.cid,
        value: testData.reposts.localRepost.value as Repost,
      }

      const result = await repostConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      expect(result!.activity).toBeInstanceOf(Announce)

      const announce = result!.activity as Announce
      expect(announce.id).toBeDefined()
      expect(announce.id?.href).toContain('/reposts/')
      expect(announce.actorId?.href).toContain(testData.users.bob.did)

      // Verify the object is the Note being reposted
      expect(announce.objectId).toBeDefined()
      expect(announce.objectId?.href).toContain(
        testData.reposts.localRepost.value.subject.uri,
      )
    })

    it('should return null for reposts of external posts', async () => {
      const federation = createFederation<void>()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const ctx = federation.createContext(
        new URL('https://ap.example'),
        undefined,
      )

      // Mock PDS client to return null for external users
      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockResolvedValue(null),
      })

      const record = {
        uri: testData.reposts.externalRepost.uri,
        cid: testData.reposts.externalRepost.cid,
        value: testData.reposts.externalRepost.value as Repost,
      }

      const result = await repostConverter.toActivityPub(
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
        uri: testData.reposts.localRepost.uri,
        cid: testData.reposts.localRepost.cid,
        value: testData.reposts.localRepost.value as Repost,
      }

      const result = await repostConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const announce = result!.activity as Announce

      const toRecipients: string[] = []
      for await (const url of announce.toIds!) {
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
        uri: testData.reposts.localRepost.uri,
        cid: testData.reposts.localRepost.cid,
        value: testData.reposts.localRepost.value as Repost,
      }

      const result = await repostConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const announce = result!.activity as Announce

      const ccRecipients: string[] = []
      for await (const url of announce.ccIds!) {
        ccRecipients.push(url.href)
      }
      expect(ccRecipients.length).toBeGreaterThan(0)
      expect(ccRecipients[0]).toContain('/followers')
    })

    it('should set correct published timestamp from repost createdAt', async () => {
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
        uri: testData.reposts.localRepost.uri,
        cid: testData.reposts.localRepost.cid,
        value: testData.reposts.localRepost.value as Repost,
      }

      const result = await repostConverter.toActivityPub(
        ctx as unknown as Context<void>,
        testData.users.bob.did,
        record,
        pdsClient as unknown as PDSClient,
      )

      expect(result).toBeDefined()
      const announce = result!.activity as Announce
      expect(announce.published).toBeDefined()
      // Temporal.Instant normalizes the timestamp format, so we compare dates
      expect(announce.published?.epochMilliseconds).toBe(
        new Date(testData.reposts.localRepost.value.createdAt).getTime(),
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

      const result = await repostConverter.toRecord(
        ctx as unknown as Context<void>,
        testData.users.alice.did,
        note,
      )

      expect(result).toBeNull()
    })
  })
})
