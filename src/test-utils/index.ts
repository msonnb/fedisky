import { vi, type Mock } from 'vitest'
import type { BlueskyBridgeAccountManager } from '../bluesky-bridge'
import type { BridgeAccountManager } from '../bridge-account'
import { APDatabase } from '../db'
import type { PDSClient } from '../pds-client'

export async function createTestDb(): Promise<APDatabase> {
  const db = new APDatabase(':memory:')
  await db.migrate()
  return db
}

export function createMockPdsClient(
  overrides: Partial<PDSClient> = {},
): PDSClient {
  return {
    getAccount: vi.fn().mockResolvedValue(null),
    getAccounts: vi.fn().mockResolvedValue([]),
    getAccountCount: vi.fn().mockResolvedValue(0),
    getRecord: vi.fn().mockResolvedValue(null),
    listRecords: vi.fn().mockResolvedValue({ records: [] }),
    createRecord: vi
      .fn()
      .mockResolvedValue({ uri: 'at://test/test/test', cid: 'bafytest' }),
    getProfile: vi.fn().mockResolvedValue(null),
    resolveHandle: vi.fn().mockResolvedValue(null),
    createInviteCode: vi.fn().mockResolvedValue('test-invite-code'),
    createAccount: vi.fn().mockResolvedValue({
      did: 'did:plc:test',
      handle: 'test.handle',
      accessJwt: 'test-access-jwt',
      refreshJwt: 'test-refresh-jwt',
    }),
    createSession: vi.fn().mockResolvedValue({
      accessJwt: 'test-access-jwt',
      refreshJwt: 'test-refresh-jwt',
    }),
    refreshSession: vi.fn().mockResolvedValue({
      accessJwt: 'new-access-jwt',
      refreshJwt: 'new-refresh-jwt',
    }),
    createAuthenticatedAgent: vi.fn(),
    getBlobUrl: vi.fn(
      (did: string, cid: string) =>
        `https://pds.example/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`,
    ),
    getImageUrl: vi.fn(
      (did: string, cid: string) =>
        `https://pds.example/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`,
    ),
    ...overrides,
  } as unknown as PDSClient
}

export function createMockBridgeAccount(
  overrides: Partial<BridgeAccountManager> & {
    _did?: string
    _handle?: string
  } = {},
): { [K in keyof BridgeAccountManager]: Mock } & {
  did: string
  handle: string
} {
  const {
    _did = 'did:plc:bridge',
    _handle = 'bridge.test',
    ...rest
  } = overrides
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    get did() {
      return _did
    },
    get handle() {
      return _handle
    },
    initialize: vi.fn().mockResolvedValue(undefined),
    getAgent: vi.fn().mockResolvedValue({}),
    createRecord: vi.fn().mockResolvedValue({
      uri: `at://${_did}/app.bsky.feed.post/test123`,
      cid: 'bafytest',
    }),
    uploadBlob: vi.fn().mockResolvedValue({
      ref: { toString: () => 'bafyblob' },
      mimeType: 'image/jpeg',
      size: 1000,
    }),
    ...rest,
  } as unknown as { [K in keyof BridgeAccountManager]: Mock } & {
    did: string
    handle: string
  }
}

export function createMockBlueskyBridgeAccount(
  overrides: Partial<BlueskyBridgeAccountManager> & {
    _did?: string | null
    _handle?: string | null
    _available?: boolean
  } = {},
): { [K in keyof BlueskyBridgeAccountManager]: Mock } & {
  did: string | null
  handle: string | null
} {
  const {
    _did = null,
    _handle = null,
    _available = false,
    ...rest
  } = overrides
  return {
    isAvailable: vi.fn().mockReturnValue(_available),
    get did() {
      return _did
    },
    get handle() {
      return _handle
    },
    initialize: vi.fn().mockResolvedValue(undefined),
    getAgent: vi.fn().mockResolvedValue({}),
    createRecord: vi.fn().mockResolvedValue({
      uri: `at://${_did}/app.bsky.feed.post/test123`,
      cid: 'bafytest',
    }),
    uploadBlob: vi.fn().mockResolvedValue({
      ref: { toString: () => 'bafyblob' },
      mimeType: 'image/jpeg',
      size: 1000,
    }),
    ...rest,
  } as unknown as { [K in keyof BlueskyBridgeAccountManager]: Mock } & {
    did: string | null
    handle: string | null
  }
}

export const testData = {
  users: {
    alice: {
      did: 'did:plc:alice123',
      handle: 'alice.test',
    },
    bob: {
      did: 'did:plc:bob456',
      handle: 'bob.test',
    },
    external: {
      did: 'did:plc:external789',
      handle: 'external.other',
    },
  },
  posts: {
    simple: {
      uri: 'at://did:plc:alice123/app.bsky.feed.post/abc123',
      cid: 'bafyreiabc123',
      value: {
        $type: 'app.bsky.feed.post',
        text: 'Hello world!',
        createdAt: '2024-01-15T12:00:00.000Z',
      },
    },
    withImages: {
      uri: 'at://did:plc:alice123/app.bsky.feed.post/img456',
      cid: 'bafyreiimg456',
      value: {
        $type: 'app.bsky.feed.post',
        text: 'Check out this photo!',
        createdAt: '2024-01-15T12:00:00.000Z',
        embed: {
          $type: 'app.bsky.embed.images',
          images: [
            {
              image: {
                cid: 'bafkreihrn6b2blc3jk34cvmqyolxc27i4c567s57d5r2k4d2z3fpfsfdqa',
                mimeType: 'image/jpeg',
              },
              alt: 'A test image',
            },
          ],
        },
      },
    },
    reply: {
      uri: 'at://did:plc:bob456/app.bsky.feed.post/reply789',
      cid: 'bafyreireply789',
      value: {
        $type: 'app.bsky.feed.post',
        text: 'This is a reply!',
        createdAt: '2024-01-15T13:00:00.000Z',
        reply: {
          root: {
            uri: 'at://did:plc:alice123/app.bsky.feed.post/abc123',
            cid: 'bafyreiabc123',
          },
          parent: {
            uri: 'at://did:plc:alice123/app.bsky.feed.post/abc123',
            cid: 'bafyreiabc123',
          },
        },
      },
    },
  },
  reposts: {
    localRepost: {
      uri: 'at://did:plc:bob456/app.bsky.feed.repost/repost123',
      cid: 'bafyreirepost123',
      value: {
        $type: 'app.bsky.feed.repost',
        subject: {
          uri: 'at://did:plc:alice123/app.bsky.feed.post/abc123',
          cid: 'bafyreiabc123',
        },
        createdAt: '2024-01-15T14:00:00.000Z',
      },
    },
    externalRepost: {
      uri: 'at://did:plc:bob456/app.bsky.feed.repost/repost456',
      cid: 'bafyreirepost456',
      value: {
        $type: 'app.bsky.feed.repost',
        subject: {
          uri: 'at://did:plc:external789/app.bsky.feed.post/extpost1',
          cid: 'bafyreiextpost1',
        },
        createdAt: '2024-01-15T15:00:00.000Z',
      },
    },
  },
  likes: {
    localLike: {
      uri: 'at://did:plc:bob456/app.bsky.feed.like/like123',
      cid: 'bafyreiLike123',
      value: {
        $type: 'app.bsky.feed.like',
        subject: {
          uri: 'at://did:plc:alice123/app.bsky.feed.post/abc123',
          cid: 'bafyreiabc123',
        },
        createdAt: '2024-01-15T14:30:00.000Z',
      },
    },
    externalLike: {
      uri: 'at://did:plc:bob456/app.bsky.feed.like/like456',
      cid: 'bafyreiLike456',
      value: {
        $type: 'app.bsky.feed.like',
        subject: {
          uri: 'at://did:plc:external789/app.bsky.feed.post/extpost1',
          cid: 'bafyreiextpost1',
        },
        createdAt: '2024-01-15T15:30:00.000Z',
      },
    },
  },
}
