import { Accept, Create, Follow, Note, Person, Undo } from '@fedify/fedify'
import type { InboxContext } from '@fedify/fedify'
import { createFederation, createInboxContext } from '@fedify/testing'
import { Temporal } from '@js-temporal/polyfill'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AppContext } from '../../src/context'
import type { APDatabase } from '../../src/db'
import { setupInboxListeners } from '../../src/federation/inbox'
import {
  createTestDb,
  createMockPdsClient,
  createMockBridgeAccount,
  testData,
} from '../_setup'

function createTestFederation() {
  return createFederation<void>({
    contextData: null as unknown as void,
    origin: 'https://ap.example',
  })
}

function createMockInboxContext(
  federation: ReturnType<typeof createTestFederation>,
): InboxContext<void> {
  return createInboxContext<void>({
    data: null as unknown as void,
    federation,
    url: new URL('https://ap.example/inbox'),
    parseUri: (uri: URL) => {
      if (uri.pathname.startsWith('/users/')) {
        const parts = uri.pathname.split('/')
        if (parts.length >= 3) {
          return { type: 'actor', identifier: parts[2], handle: parts[2] }
        }
      }
      if (uri.pathname.startsWith('/posts/')) {
        const postUri = uri.pathname.slice('/posts/'.length)
        return {
          type: 'object',
          class: Note,
          typeId: new URL('https://www.w3.org/ns/activitystreams#Note'),
          values: { uri: postUri },
        }
      }
      return null
    },
    sendActivity: async (sender, recipients, activity) => {
      ;(federation as any).sentActivities.push({
        sender,
        recipients,
        activity,
        queued: false,
        sentOrder: ++(federation as any).sentCounter,
      })
    },
  }) as InboxContext<void>
}

async function invokeInboxListener<T>(
  federation: ReturnType<typeof createTestFederation>,
  activityType: string,
  activity: T,
) {
  const listeners = (federation as any).inboxListeners.get(activityType) || []
  const ctx = createMockInboxContext(federation)
  for (const listener of listeners) {
    await listener(ctx, activity)
  }
}

describe('inbox', () => {
  let db: APDatabase
  let mockCtx: AppContext

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(async () => {
    await db.close()
  })

  describe('Follow handling', () => {
    it('should accept a valid Follow and store it in the database', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const bridgeAccount = createMockBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const followerActor = new Person({
        id: new URL('https://remote.example/users/alice'),
        preferredUsername: 'alice',
        inbox: new URL('https://remote.example/users/alice/inbox'),
      })

      const follow = new Follow({
        id: new URL('https://remote.example/activities/follow-1'),
        actor: followerActor,
        object: new URL('https://ap.example/users/did:plc:alice123'),
      })

      await invokeInboxListener(federation, 'Follow', follow)

      const follows = await db.getFollowers(testData.users.alice.did)
      expect(follows).toHaveLength(1)
      expect(follows[0].actorUri).toBe('https://remote.example/users/alice')
      expect(follows[0].actorInbox).toBe(
        'https://remote.example/users/alice/inbox',
      )

      const sentActivities = federation.sentActivities
      expect(sentActivities.length).toBeGreaterThanOrEqual(1)
      const acceptActivity = sentActivities.find(
        (a) => a.activity instanceof Accept,
      )
      expect(acceptActivity).toBeDefined()
    })

    it('should ignore Follow with missing required fields', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const bridgeAccount = createMockBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const follow = new Follow({
        id: new URL('https://remote.example/activities/follow-bad'),
        object: new URL('https://ap.example/users/did:plc:alice123'),
        // no actorId - missing required field
      })

      await invokeInboxListener(federation, 'Follow', follow)

      const follows = await db.getFollowers(testData.users.alice.did)
      expect(follows).toHaveLength(0)

      const sentActivities = federation.sentActivities
      const acceptActivity = sentActivities.find(
        (a) => a.activity instanceof Accept,
      )
      expect(acceptActivity).toBeUndefined()
    })
  })

  describe('Undo Follow handling', () => {
    it('should remove follow from database on Undo(Follow)', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const bridgeAccount = createMockBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      await db.createFollow({
        userDid: testData.users.alice.did,
        activityId: 'https://remote.example/activities/follow-1',
        actorUri: 'https://remote.example/users/bob',
        actorInbox: 'https://remote.example/users/bob/inbox',
        createdAt: new Date().toISOString(),
      })

      let follows = await db.getFollowers(testData.users.alice.did)
      expect(follows).toHaveLength(1)

      setupInboxListeners(mockCtx)

      const originalFollow = new Follow({
        id: new URL('https://remote.example/activities/follow-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL('https://ap.example/users/did:plc:alice123'),
      })

      const undo = new Undo({
        id: new URL('https://remote.example/activities/undo-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: originalFollow,
      })

      await invokeInboxListener(federation, 'Undo', undo)

      follows = await db.getFollowers(testData.users.alice.did)
      expect(follows).toHaveLength(0)
    })
  })

  describe('Create (incoming reply) handling', () => {
    it('should create a reply via bridge account when Note replies to local post', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockResolvedValue({
          did: testData.users.alice.did,
          handle: testData.users.alice.handle,
        }),
        getRecord: vi.fn().mockResolvedValue({
          uri: testData.posts.simple.uri,
          cid: testData.posts.simple.cid,
          value: testData.posts.simple.value,
        }),
      })

      const bridgeAccount = createMockBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(true),
        createRecord: vi.fn().mockResolvedValue({
          uri: 'at://did:plc:bridge/app.bsky.feed.post/reply123',
          cid: 'bafyreply123',
        }),
      })

      mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const remoteActor = new Person({
        id: new URL('https://remote.example/users/bob'),
        preferredUsername: 'bob',
        inbox: new URL('https://remote.example/users/bob/inbox'),
      })

      const replyNote = new Note({
        id: new URL('https://remote.example/notes/reply-1'),
        content: '<p>Great post!</p>',
        replyTarget: new URL(
          `https://ap.example/posts/${testData.posts.simple.uri}`,
        ),
        published: Temporal.Now.instant(),
      })

      const create = new Create({
        id: new URL('https://remote.example/activities/create-1'),
        actor: remoteActor,
        object: replyNote,
      })

      await invokeInboxListener(federation, 'Create', create)

      expect(bridgeAccount.createRecord).toHaveBeenCalledWith(
        'app.bsky.feed.post',
        expect.objectContaining({
          text: expect.stringContaining('bob'),
          reply: expect.objectContaining({
            parent: expect.objectContaining({
              uri: testData.posts.simple.uri,
            }),
          }),
        }),
      )
    })

    it('should store post mapping when creating bridge post', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const bridgePostUri = 'at://did:plc:bridge/app.bsky.feed.post/reply123'
      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockResolvedValue({
          did: testData.users.alice.did,
          handle: testData.users.alice.handle,
        }),
        getRecord: vi.fn().mockResolvedValue({
          uri: testData.posts.simple.uri,
          cid: testData.posts.simple.cid,
          value: testData.posts.simple.value,
        }),
      })

      const bridgeAccount = createMockBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(true),
        createRecord: vi.fn().mockResolvedValue({
          uri: bridgePostUri,
          cid: 'bafyreply123',
        }),
      })

      mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const remoteActorId = 'https://remote.example/users/bob'
      const remoteActorInbox = 'https://remote.example/users/bob/inbox'
      const remoteNoteId = 'https://remote.example/notes/reply-1'

      const remoteActor = new Person({
        id: new URL(remoteActorId),
        preferredUsername: 'bob',
        inbox: new URL(remoteActorInbox),
      })

      const replyNote = new Note({
        id: new URL(remoteNoteId),
        content: '<p>Great post!</p>',
        replyTarget: new URL(
          `https://ap.example/posts/${testData.posts.simple.uri}`,
        ),
        published: Temporal.Now.instant(),
      })

      const create = new Create({
        id: new URL('https://remote.example/activities/create-1'),
        actor: remoteActor,
        object: replyNote,
      })

      await invokeInboxListener(federation, 'Create', create)

      const mapping = await db.getPostMapping(bridgePostUri)
      expect(mapping).toBeDefined()
      expect(mapping?.apNoteId).toBe(remoteNoteId)
      expect(mapping?.apActorId).toBe(remoteActorId)
      expect(mapping?.apActorInbox).toBe(remoteActorInbox)
    })

    it('should skip Create when Note is not a reply', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const bridgeAccount = createMockBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(true),
      })

      mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const remoteActor = new Person({
        id: new URL('https://remote.example/users/bob'),
        preferredUsername: 'bob',
        inbox: new URL('https://remote.example/users/bob/inbox'),
      })

      // Note without replyTarget - not a reply
      const note = new Note({
        id: new URL('https://remote.example/notes/standalone'),
        content: '<p>Just a standalone post</p>',
        published: Temporal.Now.instant(),
      })

      const create = new Create({
        id: new URL('https://remote.example/activities/create-standalone'),
        actor: remoteActor,
        object: note,
      })

      await invokeInboxListener(federation, 'Create', create)

      expect(bridgeAccount.createRecord).not.toHaveBeenCalled()
    })

    it('should skip Create when bridge account is not available', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const pdsClient = createMockPdsClient()
      const bridgeAccount = createMockBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const remoteActor = new Person({
        id: new URL('https://remote.example/users/bob'),
        preferredUsername: 'bob',
        inbox: new URL('https://remote.example/users/bob/inbox'),
      })

      const replyNote = new Note({
        id: new URL('https://remote.example/notes/reply-1'),
        content: '<p>Great post!</p>',
        replyTarget: new URL(
          `https://ap.example/posts/${testData.posts.simple.uri}`,
        ),
        published: Temporal.Now.instant(),
      })

      const create = new Create({
        id: new URL('https://remote.example/activities/create-1'),
        actor: remoteActor,
        object: replyNote,
      })

      await invokeInboxListener(federation, 'Create', create)

      expect(bridgeAccount.createRecord).not.toHaveBeenCalled()
    })
  })
})
