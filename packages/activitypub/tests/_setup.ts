import { APDatabase } from '../src/db'
import type { PDSClient } from '../src/pds-client'
import type { BridgeAccountManager } from '../src/bridge-account'

export async function createTestDb(): Promise<APDatabase> {
  const db = new APDatabase(':memory:')
  await db.migrate()
  return db
}

export function createMockPdsClient(
  overrides: Partial<PDSClient> = {},
): jest.Mocked<PDSClient> {
  return {
    getAccount: jest.fn().mockResolvedValue(null),
    getAccounts: jest.fn().mockResolvedValue([]),
    getAccountCount: jest.fn().mockResolvedValue(0),
    getRecord: jest.fn().mockResolvedValue(null),
    listRecords: jest.fn().mockResolvedValue({ records: [] }),
    createRecord: jest
      .fn()
      .mockResolvedValue({ uri: 'at://test/test/test', cid: 'bafytest' }),
    getProfile: jest.fn().mockResolvedValue(null),
    resolveHandle: jest.fn().mockResolvedValue(null),
    createInviteCode: jest.fn().mockResolvedValue('test-invite-code'),
    createAccount: jest.fn().mockResolvedValue({
      did: 'did:plc:test',
      handle: 'test.handle',
      accessJwt: 'test-access-jwt',
      refreshJwt: 'test-refresh-jwt',
    }),
    createSession: jest.fn().mockResolvedValue({
      accessJwt: 'test-access-jwt',
      refreshJwt: 'test-refresh-jwt',
    }),
    refreshSession: jest.fn().mockResolvedValue({
      accessJwt: 'new-access-jwt',
      refreshJwt: 'new-refresh-jwt',
    }),
    createAuthenticatedAgent: jest.fn(),
    getBlobUrl: jest.fn(
      (did: string, cid: string) =>
        `https://pds.example/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`,
    ),
    getImageUrl: jest.fn(
      (did: string, cid: string) =>
        `https://pds.example/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`,
    ),
    ...overrides,
  } as jest.Mocked<PDSClient>
}

/**
 * Creates a mock BridgeAccountManager with configurable method implementations
 */
export function createMockBridgeAccount(
  overrides: Partial<BridgeAccountManager> & {
    _did?: string
    _handle?: string
  } = {},
): jest.Mocked<BridgeAccountManager> {
  const {
    _did = 'did:plc:bridge',
    _handle = 'bridge.test',
    ...rest
  } = overrides
  return {
    isAvailable: jest.fn().mockReturnValue(true),
    get did() {
      return _did
    },
    get handle() {
      return _handle
    },
    initialize: jest.fn().mockResolvedValue(undefined),
    getAgent: jest.fn().mockResolvedValue({}),
    createRecord: jest.fn().mockResolvedValue({
      uri: `at://${_did}/app.bsky.feed.post/test123`,
      cid: 'bafytest',
    }),
    uploadBlob: jest.fn().mockResolvedValue({
      ref: { toString: () => 'bafyblob' },
      mimeType: 'image/jpeg',
      size: 1000,
    }),
    ...rest,
  } as unknown as jest.Mocked<BridgeAccountManager>
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
