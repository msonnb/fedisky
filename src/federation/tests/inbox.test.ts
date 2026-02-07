import type { InboxContext } from '@fedify/fedify'
import { createFederation, createInboxContext } from '@fedify/testing'
import {
  Accept,
  Announce,
  Create,
  Delete,
  Endpoints,
  Follow,
  Like,
  Note,
  Person,
  Undo,
} from '@fedify/vocab'
import { Temporal } from '@js-temporal/polyfill'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AppContext } from '../../context'
import type { APDatabase } from '../../db'
import {
  createTestDb,
  createMockPdsClient,
  createMockMastodonBridgeAccount,
  testData,
} from '../../test-utils'
import { setupInboxListeners } from '../inbox'

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
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const followerActor = new Person({
        id: new URL('https://remote.example/users/alice'),
        preferredUsername: 'alice',
        inbox: new URL('https://remote.example/users/alice/inbox'),
        endpoints: new Endpoints({
          sharedInbox: new URL('https://remote.example/inbox'),
        }),
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
      expect(follows[0].actorSharedInbox).toBe('https://remote.example/inbox')

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
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
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
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      await db.createFollow({
        userDid: testData.users.alice.did,
        activityId: 'https://remote.example/activities/follow-1',
        actorUri: 'https://remote.example/users/bob',
        actorInbox: 'https://remote.example/users/bob/inbox',
        actorSharedInbox: 'https://remote.example/inbox',
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

  describe('Delete actor handling', () => {
    it('should delete all follows, likes, and reposts from the deleted actor', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      // Create follows from the same actor to multiple users
      await db.createFollow({
        userDid: testData.users.alice.did,
        activityId: 'https://remote.example/activities/follow-1',
        actorUri: 'https://remote.example/users/bob',
        actorInbox: 'https://remote.example/users/bob/inbox',
        actorSharedInbox: 'https://remote.example/inbox',
        createdAt: new Date().toISOString(),
      })
      await db.createFollow({
        userDid: testData.users.bob.did,
        activityId: 'https://remote.example/activities/follow-2',
        actorUri: 'https://remote.example/users/bob',
        actorInbox: 'https://remote.example/users/bob/inbox',
        actorSharedInbox: 'https://remote.example/inbox',
        createdAt: new Date().toISOString(),
      })

      // Create likes and reposts from the same actor
      await db.createLike({
        activityId: 'https://remote.example/activities/like-1',
        postAtUri: testData.posts.simple.uri,
        postAuthorDid: testData.users.alice.did,
        apActorId: 'https://remote.example/users/bob',
        createdAt: new Date().toISOString(),
      })
      await db.createRepost({
        activityId: 'https://remote.example/activities/announce-1',
        postAtUri: testData.posts.simple.uri,
        postAuthorDid: testData.users.alice.did,
        apActorId: 'https://remote.example/users/bob',
        createdAt: new Date().toISOString(),
      })

      expect(await db.getFollowers(testData.users.alice.did)).toHaveLength(1)
      expect(await db.getFollowers(testData.users.bob.did)).toHaveLength(1)
      expect(await db.getLikesForPost(testData.posts.simple.uri)).toHaveLength(
        1,
      )
      expect(
        await db.getRepostsForPost(testData.posts.simple.uri),
      ).toHaveLength(1)

      setupInboxListeners(mockCtx)

      const del = new Delete({
        id: new URL('https://remote.example/activities/delete-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL('https://remote.example/users/bob'),
      })

      await invokeInboxListener(federation, 'Delete', del)

      expect(await db.getFollowers(testData.users.alice.did)).toHaveLength(0)
      expect(await db.getFollowers(testData.users.bob.did)).toHaveLength(0)
      expect(await db.getLikesForPost(testData.posts.simple.uri)).toHaveLength(
        0,
      )
      expect(
        await db.getRepostsForPost(testData.posts.simple.uri),
      ).toHaveLength(0)
    })

    it('should delete bridged posts and post mappings when actor is deleted', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(true),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      // Create post mappings for the actor being deleted
      await db.createPostMapping({
        atUri: 'at://did:plc:bridge/app.bsky.feed.post/reply1',
        apNoteId: 'https://remote.example/notes/note-1',
        apActorId: 'https://remote.example/users/bob',
        apActorInbox: 'https://remote.example/users/bob/inbox',
        createdAt: new Date().toISOString(),
      })
      await db.createPostMapping({
        atUri: 'at://did:plc:bridge/app.bsky.feed.post/reply2',
        apNoteId: 'https://remote.example/notes/note-2',
        apActorId: 'https://remote.example/users/bob',
        apActorInbox: 'https://remote.example/users/bob/inbox',
        createdAt: new Date().toISOString(),
      })

      setupInboxListeners(mockCtx)

      const del = new Delete({
        id: new URL('https://remote.example/activities/delete-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL('https://remote.example/users/bob'),
      })

      await invokeInboxListener(federation, 'Delete', del)

      // Verify bridged posts were deleted via bridge account
      expect(mastodonBridgeAccount.deleteRecord).toHaveBeenCalledTimes(2)
      expect(mastodonBridgeAccount.deleteRecord).toHaveBeenCalledWith(
        'app.bsky.feed.post',
        'reply1',
      )
      expect(mastodonBridgeAccount.deleteRecord).toHaveBeenCalledWith(
        'app.bsky.feed.post',
        'reply2',
      )

      // Verify post mappings were removed
      const mappings = await db.getPostMappingsByActor(
        'https://remote.example/users/bob',
      )
      expect(mappings).toHaveLength(0)
    })
  })

  describe('Delete note handling', () => {
    it('should delete bridged post and mapping when note is deleted', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(true),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      // Create a post mapping for the note being deleted
      const bridgedUri = 'at://did:plc:bridge/app.bsky.feed.post/reply123'
      const noteId = 'https://remote.example/notes/note-1'
      await db.createPostMapping({
        atUri: bridgedUri,
        apNoteId: noteId,
        apActorId: 'https://remote.example/users/bob',
        apActorInbox: 'https://remote.example/users/bob/inbox',
        createdAt: new Date().toISOString(),
      })

      setupInboxListeners(mockCtx)

      const del = new Delete({
        id: new URL('https://remote.example/activities/delete-note-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL(noteId),
      })

      await invokeInboxListener(federation, 'Delete', del)

      // Verify bridged post was deleted
      expect(mastodonBridgeAccount.deleteRecord).toHaveBeenCalledWith(
        'app.bsky.feed.post',
        'reply123',
      )

      // Verify mapping was removed
      const mapping = await db.getPostMappingByApNoteId(noteId)
      expect(mapping).toBeUndefined()
    })

    it('should be a no-op when no mapping exists for deleted note', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(true),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const del = new Delete({
        id: new URL('https://remote.example/activities/delete-note-2'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL('https://remote.example/notes/nonexistent'),
      })

      await invokeInboxListener(federation, 'Delete', del)

      // Should not attempt to delete any record
      expect(mastodonBridgeAccount.deleteRecord).not.toHaveBeenCalled()
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

      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(true),
        createRecord: vi.fn().mockResolvedValue({
          uri: 'at://did:plc:bridge/app.bsky.feed.post/reply123',
          cid: 'bafyreply123',
        }),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
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

      expect(mastodonBridgeAccount.createRecord).toHaveBeenCalledWith(
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

      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(true),
        createRecord: vi.fn().mockResolvedValue({
          uri: bridgePostUri,
          cid: 'bafyreply123',
        }),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
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
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(true),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
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

      expect(mastodonBridgeAccount.createRecord).not.toHaveBeenCalled()
    })

    it('should skip Create when bridge account is not available', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const pdsClient = createMockPdsClient()
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
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

      expect(mastodonBridgeAccount.createRecord).not.toHaveBeenCalled()
    })
  })

  describe('Like handling', () => {
    it('should store a valid Like in the database', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockResolvedValue({
          did: testData.users.alice.did,
          handle: testData.users.alice.handle,
        }),
      })
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const like = new Like({
        id: new URL('https://remote.example/activities/like-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL(
          `https://ap.example/posts/${testData.posts.simple.uri}`,
        ),
      })

      await invokeInboxListener(federation, 'Like', like)

      const likes = await db.getLikesForPost(testData.posts.simple.uri)
      expect(likes).toHaveLength(1)
      expect(likes[0].activityId).toBe(
        'https://remote.example/activities/like-1',
      )
      expect(likes[0].apActorId).toBe('https://remote.example/users/bob')
      expect(likes[0].postAtUri).toBe(testData.posts.simple.uri)
      expect(likes[0].postAuthorDid).toBe(testData.users.alice.did)
    })

    it('should ignore Like with missing required fields', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const like = new Like({
        id: new URL('https://remote.example/activities/like-bad'),
        // missing actor and object
      })

      await invokeInboxListener(federation, 'Like', like)

      const count = await db.getLikesCountForPost(testData.posts.simple.uri)
      expect(count).toBe(0)
    })

    it('should ignore Like for non-local post', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const like = new Like({
        id: new URL('https://remote.example/activities/like-ext'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL('https://other.example/notes/123'),
      })

      await invokeInboxListener(federation, 'Like', like)

      const count = await db.getLikesCountForPost(testData.posts.simple.uri)
      expect(count).toBe(0)
    })

    it('should be idempotent for duplicate likes', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockResolvedValue({
          did: testData.users.alice.did,
          handle: testData.users.alice.handle,
        }),
      })
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const like = new Like({
        id: new URL('https://remote.example/activities/like-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL(
          `https://ap.example/posts/${testData.posts.simple.uri}`,
        ),
      })

      await invokeInboxListener(federation, 'Like', like)
      await invokeInboxListener(federation, 'Like', like)

      const likes = await db.getLikesForPost(testData.posts.simple.uri)
      expect(likes).toHaveLength(1)
    })
  })

  describe('Announce handling', () => {
    it('should store a valid Announce in the database', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const pdsClient = createMockPdsClient({
        getAccount: vi.fn().mockResolvedValue({
          did: testData.users.alice.did,
          handle: testData.users.alice.handle,
        }),
      })
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const announce = new Announce({
        id: new URL('https://remote.example/activities/announce-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL(
          `https://ap.example/posts/${testData.posts.simple.uri}`,
        ),
      })

      await invokeInboxListener(federation, 'Announce', announce)

      const reposts = await db.getRepostsForPost(testData.posts.simple.uri)
      expect(reposts).toHaveLength(1)
      expect(reposts[0].activityId).toBe(
        'https://remote.example/activities/announce-1',
      )
      expect(reposts[0].apActorId).toBe('https://remote.example/users/bob')
      expect(reposts[0].postAtUri).toBe(testData.posts.simple.uri)
      expect(reposts[0].postAuthorDid).toBe(testData.users.alice.did)
    })

    it('should ignore Announce with missing required fields', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const announce = new Announce({
        id: new URL('https://remote.example/activities/announce-bad'),
        // missing actor and object
      })

      await invokeInboxListener(federation, 'Announce', announce)

      const count = await db.getRepostsCountForPost(testData.posts.simple.uri)
      expect(count).toBe(0)
    })

    it('should ignore Announce for non-local post', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      setupInboxListeners(mockCtx)

      const announce = new Announce({
        id: new URL('https://remote.example/activities/announce-ext'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL('https://other.example/notes/123'),
      })

      await invokeInboxListener(federation, 'Announce', announce)

      const count = await db.getRepostsCountForPost(testData.posts.simple.uri)
      expect(count).toBe(0)
    })
  })

  describe('Undo Like handling', () => {
    it('should remove like from database on Undo(Like)', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      await db.createLike({
        activityId: 'https://remote.example/activities/like-1',
        postAtUri: testData.posts.simple.uri,
        postAuthorDid: testData.users.alice.did,
        apActorId: 'https://remote.example/users/bob',
        createdAt: new Date().toISOString(),
      })

      let likes = await db.getLikesForPost(testData.posts.simple.uri)
      expect(likes).toHaveLength(1)

      setupInboxListeners(mockCtx)

      const originalLike = new Like({
        id: new URL('https://remote.example/activities/like-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL(
          `https://ap.example/posts/${testData.posts.simple.uri}`,
        ),
      })

      const undo = new Undo({
        id: new URL('https://remote.example/activities/undo-like-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: originalLike,
      })

      await invokeInboxListener(federation, 'Undo', undo)

      likes = await db.getLikesForPost(testData.posts.simple.uri)
      expect(likes).toHaveLength(0)
    })
  })

  describe('Undo Announce handling', () => {
    it('should remove repost from database on Undo(Announce)', async () => {
      const federation = createTestFederation()
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()
      const mastodonBridgeAccount = createMockMastodonBridgeAccount({
        isAvailable: vi.fn().mockReturnValue(false),
      })

      mockCtx = {
        db,
        pdsClient,
        mastodonBridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          mastodonBridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      await db.createRepost({
        activityId: 'https://remote.example/activities/announce-1',
        postAtUri: testData.posts.simple.uri,
        postAuthorDid: testData.users.alice.did,
        apActorId: 'https://remote.example/users/bob',
        createdAt: new Date().toISOString(),
      })

      let reposts = await db.getRepostsForPost(testData.posts.simple.uri)
      expect(reposts).toHaveLength(1)

      setupInboxListeners(mockCtx)

      const originalAnnounce = new Announce({
        id: new URL('https://remote.example/activities/announce-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: new URL(
          `https://ap.example/posts/${testData.posts.simple.uri}`,
        ),
      })

      const undo = new Undo({
        id: new URL('https://remote.example/activities/undo-announce-1'),
        actor: new URL('https://remote.example/users/bob'),
        object: originalAnnounce,
      })

      await invokeInboxListener(federation, 'Undo', undo)

      reposts = await db.getRepostsForPost(testData.posts.simple.uri)
      expect(reposts).toHaveLength(0)
    })
  })
})
