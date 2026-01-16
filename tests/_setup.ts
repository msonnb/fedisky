import { vi, type Mock } from 'vitest'
import type { BridgeAccountManager } from '../src/bridge-account'
import { APDatabase } from '../src/db'
import type { PDSClient } from '../src/pds-client'

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

/**
 * Creates a mock BridgeAccountManager with configurable method implementations
 */
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

export function createMockAppContext(
  overrides: {
    db?: APDatabase
    pdsClient?: Partial<PDSClient>
    bridgeAccount?: Partial<BridgeAccountManager>
    cfg?: Partial<{
      service: { publicUrl: string }
      pds: { url: string }
      bridge: { handle: string }
    }>
  } = {},
) {
  return {
    db: overrides.db,
    pdsClient: createMockPdsClient(overrides.pdsClient),
    bridgeAccount: createMockBridgeAccount(overrides.bridgeAccount as any),
    cfg: {
      service: { publicUrl: 'https://ap.example' },
      pds: { url: 'https://pds.example' },
      bridge: { handle: 'bridge.test' },
      ...overrides.cfg,
    },
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
                // Use untypedJsonBlobRef format with a valid CID
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
}
