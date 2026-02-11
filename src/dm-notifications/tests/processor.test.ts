import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { APDatabase } from '../../db'
import { ChatClient } from '../chat-client'
import { DmNotificationProcessor } from '../processor'

// Mock the logging module
vi.mock('../../logging', () => ({
  createWideEvent: () => ({
    set: vi.fn().mockReturnThis(),
    setOutcome: vi.fn().mockReturnThis(),
    setError: vi.fn().mockReturnThis(),
    emit: vi.fn(),
  }),
}))

// Mock the actor resolver to avoid network calls
vi.mock('../actor-resolver', () => ({
  ActorResolver: class {
    async resolve(url: string): Promise<string> {
      try {
        const parsed = new URL(url)
        const parts = parsed.pathname.split('/').filter(Boolean)
        return `@${parts[parts.length - 1]}@${parsed.hostname}`
      } catch {
        return url
      }
    }
    clearCache(): void {}
  },
}))

function createMockCtx(db: APDatabase) {
  return {
    db,
    cfg: {
      service: { publicUrl: 'https://test.example.com' },
      dmNotifications: {
        enabled: true,
        pollInterval: 1000,
        batchDelay: 0, // No delay for tests
      },
    },
    pdsClient: {
      getRecord: vi.fn().mockResolvedValue({
        uri: 'at://did:plc:author1/app.bsky.feed.post/abc',
        cid: 'cid123',
        value: { text: 'Hello world!' },
      }),
    },
    federation: {
      createContext: vi.fn().mockReturnValue({
        getDocumentLoader: vi.fn().mockResolvedValue({}),
      }),
    },
  } as unknown as Parameters<
    (typeof DmNotificationProcessor)['prototype']['poll']
  > extends []
    ? never
    : never
}

describe('DmNotificationProcessor', () => {
  let db: APDatabase
  let mockChatClient: ChatClient
  let processor: DmNotificationProcessor

  beforeEach(async () => {
    db = new APDatabase(':memory:')
    await db.migrate()

    mockChatClient = {
      sendDm: vi.fn().mockResolvedValue(true),
    } as unknown as ChatClient

    const ctx = createMockCtx(db)

    processor = new DmNotificationProcessor(ctx as never, mockChatClient)
  })

  afterEach(async () => {
    await processor.stop()
    await db.close()
  })

  it('should do nothing when no unnotified likes or reposts exist', async () => {
    await processor.poll()

    expect(mockChatClient.sendDm).not.toHaveBeenCalled()
  })

  it('should send a DM for unnotified likes', async () => {
    await db.createLike({
      activityId: 'https://mastodon.social/likes/1',
      postAtUri: 'at://did:plc:author1/app.bsky.feed.post/abc',
      postAuthorDid: 'did:plc:author1',
      apActorId: 'https://mastodon.social/users/alice',
      createdAt: new Date(Date.now() - 1000).toISOString(),
    })

    await processor.poll()

    expect(mockChatClient.sendDm).toHaveBeenCalledTimes(1)
    expect(mockChatClient.sendDm).toHaveBeenCalledWith(
      'did:plc:author1',
      expect.stringContaining('Fediverse engagement'),
    )
  })

  it('should send a DM for unnotified reposts', async () => {
    await db.createRepost({
      activityId: 'https://mastodon.social/announces/1',
      postAtUri: 'at://did:plc:author1/app.bsky.feed.post/abc',
      postAuthorDid: 'did:plc:author1',
      apActorId: 'https://mastodon.social/users/alice',
      createdAt: new Date(Date.now() - 1000).toISOString(),
    })

    await processor.poll()

    expect(mockChatClient.sendDm).toHaveBeenCalledTimes(1)
    expect(mockChatClient.sendDm).toHaveBeenCalledWith(
      'did:plc:author1',
      expect.stringContaining('repost'),
    )
  })

  it('should group likes and reposts by author', async () => {
    // Author 1: 2 likes
    await db.createLike({
      activityId: 'https://mastodon.social/likes/1',
      postAtUri: 'at://did:plc:author1/app.bsky.feed.post/abc',
      postAuthorDid: 'did:plc:author1',
      apActorId: 'https://mastodon.social/users/alice',
      createdAt: new Date(Date.now() - 1000).toISOString(),
    })
    await db.createLike({
      activityId: 'https://fosstodon.org/likes/2',
      postAtUri: 'at://did:plc:author1/app.bsky.feed.post/abc',
      postAuthorDid: 'did:plc:author1',
      apActorId: 'https://fosstodon.org/users/bob',
      createdAt: new Date(Date.now() - 1000).toISOString(),
    })

    // Author 2: 1 repost
    await db.createRepost({
      activityId: 'https://mastodon.social/announces/1',
      postAtUri: 'at://did:plc:author2/app.bsky.feed.post/def',
      postAuthorDid: 'did:plc:author2',
      apActorId: 'https://mastodon.social/users/charlie',
      createdAt: new Date(Date.now() - 1000).toISOString(),
    })

    await processor.poll()

    expect(mockChatClient.sendDm).toHaveBeenCalledTimes(2)
  })

  it('should mark likes and reposts as notified after successful DM', async () => {
    await db.createLike({
      activityId: 'https://mastodon.social/likes/1',
      postAtUri: 'at://did:plc:author1/app.bsky.feed.post/abc',
      postAuthorDid: 'did:plc:author1',
      apActorId: 'https://mastodon.social/users/alice',
      createdAt: new Date(Date.now() - 1000).toISOString(),
    })

    await processor.poll()

    // Should be marked as notified
    const unnotified = await db.getUnnotifiedLikes(
      new Date().toISOString(),
      100,
    )
    expect(unnotified).toHaveLength(0)
  })

  it('should not mark items as notified when DM fails', async () => {
    ;(mockChatClient.sendDm as ReturnType<typeof vi.fn>).mockResolvedValue(
      false,
    )

    await db.createLike({
      activityId: 'https://mastodon.social/likes/1',
      postAtUri: 'at://did:plc:author1/app.bsky.feed.post/abc',
      postAuthorDid: 'did:plc:author1',
      apActorId: 'https://mastodon.social/users/alice',
      createdAt: new Date(Date.now() - 1000).toISOString(),
    })

    await processor.poll()

    // Should still be unnotified
    const unnotified = await db.getUnnotifiedLikes(
      new Date().toISOString(),
      100,
    )
    expect(unnotified).toHaveLength(1)
  })

  it('should skip remaining authors when first DM fails', async () => {
    ;(mockChatClient.sendDm as ReturnType<typeof vi.fn>).mockResolvedValue(
      false,
    )

    await db.createLike({
      activityId: 'https://mastodon.social/likes/1',
      postAtUri: 'at://did:plc:author1/app.bsky.feed.post/abc',
      postAuthorDid: 'did:plc:author1',
      apActorId: 'https://mastodon.social/users/alice',
      createdAt: new Date(Date.now() - 1000).toISOString(),
    })

    await db.createLike({
      activityId: 'https://mastodon.social/likes/2',
      postAtUri: 'at://did:plc:author2/app.bsky.feed.post/def',
      postAuthorDid: 'did:plc:author2',
      apActorId: 'https://mastodon.social/users/bob',
      createdAt: new Date(Date.now() - 1000).toISOString(),
    })

    await processor.poll()

    // Only one attempt should be made since first failed
    expect(mockChatClient.sendDm).toHaveBeenCalledTimes(1)
  })

  it('should include likes and reposts for the same post', async () => {
    await db.createLike({
      activityId: 'https://mastodon.social/likes/1',
      postAtUri: 'at://did:plc:author1/app.bsky.feed.post/abc',
      postAuthorDid: 'did:plc:author1',
      apActorId: 'https://mastodon.social/users/alice',
      createdAt: new Date(Date.now() - 1000).toISOString(),
    })

    await db.createRepost({
      activityId: 'https://mastodon.social/announces/1',
      postAtUri: 'at://did:plc:author1/app.bsky.feed.post/abc',
      postAuthorDid: 'did:plc:author1',
      apActorId: 'https://fosstodon.org/users/bob',
      createdAt: new Date(Date.now() - 1000).toISOString(),
    })

    await processor.poll()

    // Should send a single DM with both like and repost info
    expect(mockChatClient.sendDm).toHaveBeenCalledTimes(1)
    const message = (mockChatClient.sendDm as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string
    expect(message).toContain('like')
    expect(message).toContain('repost')
  })
})
