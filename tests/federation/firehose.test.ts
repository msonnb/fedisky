import { createFederation } from '@fedify/testing'
import { Delete, Note, PUBLIC_COLLECTION } from '@fedify/fedify'
import { FirehoseProcessor } from '../../src/firehose/processor'
import {
  createTestDb,
  createMockPdsClient,
  createMockBridgeAccount,
  testData,
} from '../_setup'
import type { APDatabase } from '../../src/db'
import type { AppContext } from '../../src/context'

describe('FirehoseProcessor', () => {
  let db: APDatabase

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(async () => {
    await db.close()
  })

  describe('processCommit', () => {
    it('should send Create activity to followers for new posts', async () => {
      const federation = createFederation<void>({
        contextData: undefined,
        origin: 'https://ap.example',
      })
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const pdsClient = createMockPdsClient({
        getRecord: jest.fn().mockResolvedValue({
          uri: testData.posts.simple.uri,
          cid: testData.posts.simple.cid,
          value: testData.posts.simple.value,
        }),
      })

      const bridgeAccount = createMockBridgeAccount({
        isAvailable: jest.fn().mockReturnValue(true),
        _did: 'did:plc:bridge',
      })

      const mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          pds: { url: 'https://pds.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      const processor = new FirehoseProcessor(mockCtx)

      // Access the private processCommit method for testing
      const processCommit = (processor as any).processCommit.bind(processor)

      await processCommit({
        repo: testData.users.alice.did,
        ops: [
          {
            action: 'create',
            path: 'app.bsky.feed.post/abc123',
            cid: 'bafyreiabc123',
          },
        ],
        seq: 1,
      })

      // Verify the record was fetched
      expect(pdsClient.getRecord).toHaveBeenCalledWith(
        testData.users.alice.did,
        'app.bsky.feed.post',
        'abc123',
      )

      // Verify activity was sent via federation
      const sentActivities = federation.sentActivities
      expect(sentActivities.length).toBeGreaterThanOrEqual(1)
    })

    it('should skip commits from the bridge account', async () => {
      const federation = createFederation<void>({
        contextData: undefined,
        origin: 'https://ap.example',
      })
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()

      const bridgeDid = 'did:plc:bridge'
      const bridgeAccount = createMockBridgeAccount({
        isAvailable: jest.fn().mockReturnValue(true),
        _did: bridgeDid,
      })

      const mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          pds: { url: 'https://pds.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      const processor = new FirehoseProcessor(mockCtx)
      const processCommit = (processor as any).processCommit.bind(processor)

      // Send a commit from the bridge account itself
      await processCommit({
        repo: bridgeDid, // Bridge account's DID
        ops: [
          {
            action: 'create',
            path: 'app.bsky.feed.post/bridgepost123',
            cid: 'bafybridgepost',
          },
        ],
        seq: 1,
      })

      // Verify the record was NOT fetched (we skipped processing)
      expect(pdsClient.getRecord).not.toHaveBeenCalled()

      // Verify no activity was sent
      const sentActivities = federation.sentActivities
      expect(sentActivities).toHaveLength(0)
    })

    it('should skip ops for collections without a converter', async () => {
      const federation = createFederation<void>({
        contextData: undefined,
        origin: 'https://ap.example',
      })
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()

      const bridgeAccount = createMockBridgeAccount({
        isAvailable: jest.fn().mockReturnValue(true),
        _did: 'did:plc:bridge',
      })

      const mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          pds: { url: 'https://pds.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      const processor = new FirehoseProcessor(mockCtx)
      const processCommit = (processor as any).processCommit.bind(processor)

      // Send a commit for a collection without a converter (like follows)
      await processCommit({
        repo: testData.users.alice.did,
        ops: [
          {
            action: 'create',
            path: 'app.bsky.graph.follow/xyz789', // No converter for this
            cid: 'bafyfollow',
          },
        ],
        seq: 1,
      })

      // Verify the record was NOT fetched
      expect(pdsClient.getRecord).not.toHaveBeenCalled()

      // Verify no activity was sent
      const sentActivities = federation.sentActivities
      expect(sentActivities).toHaveLength(0)
    })

    it('should skip non-create actions', async () => {
      const federation = createFederation<void>({
        contextData: undefined,
        origin: 'https://ap.example',
      })
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()

      const bridgeAccount = createMockBridgeAccount({
        isAvailable: jest.fn().mockReturnValue(true),
        _did: 'did:plc:bridge',
      })

      const mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          pds: { url: 'https://pds.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      const processor = new FirehoseProcessor(mockCtx)
      const processCommit = (processor as any).processCommit.bind(processor)

      // Send update ops (not create or delete)
      await processCommit({
        repo: testData.users.alice.did,
        ops: [
          {
            action: 'update',
            path: 'app.bsky.feed.post/abc123',
            cid: 'bafyupdate',
          },
        ],
        seq: 1,
      })

      // Verify the record was NOT fetched
      expect(pdsClient.getRecord).not.toHaveBeenCalled()
    })
  })

  describe('processDelete', () => {
    it('should send Delete activity to followers when post is deleted', async () => {
      const federation = createFederation<void>({
        contextData: undefined,
        origin: 'https://ap.example',
      })
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const pdsClient = createMockPdsClient()

      const bridgeAccount = createMockBridgeAccount({
        isAvailable: jest.fn().mockReturnValue(true),
        _did: 'did:plc:bridge',
      })

      const mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          pds: { url: 'https://pds.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      const processor = new FirehoseProcessor(mockCtx)
      const processCommit = (processor as any).processCommit.bind(processor)

      await processCommit({
        repo: testData.users.alice.did,
        ops: [
          {
            action: 'delete',
            path: 'app.bsky.feed.post/abc123',
          },
        ],
        seq: 1,
      })

      // Verify Delete activity was sent
      const sentActivities = federation.sentActivities
      expect(sentActivities.length).toBeGreaterThanOrEqual(1)

      const deleteActivity = sentActivities.find(
        (a) => a.activity instanceof Delete,
      )
      expect(deleteActivity).toBeDefined()
      expect(deleteActivity!.activity.actorId?.href).toContain(
        testData.users.alice.did,
      )
    })

    it('should include PUBLIC_COLLECTION in to field for Delete activity', async () => {
      const federation = createFederation<void>({
        contextData: undefined,
        origin: 'https://ap.example',
      })
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const pdsClient = createMockPdsClient()

      const bridgeAccount = createMockBridgeAccount({
        isAvailable: jest.fn().mockReturnValue(true),
        _did: 'did:plc:bridge',
      })

      const mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          pds: { url: 'https://pds.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      const processor = new FirehoseProcessor(mockCtx)
      const processCommit = (processor as any).processCommit.bind(processor)

      await processCommit({
        repo: testData.users.alice.did,
        ops: [
          {
            action: 'delete',
            path: 'app.bsky.feed.post/abc123',
          },
        ],
        seq: 1,
      })

      const sentActivities = federation.sentActivities
      const deleteActivity = sentActivities.find(
        (a) => a.activity instanceof Delete,
      )

      expect(deleteActivity).toBeDefined()
      // Check that the Delete activity has PUBLIC_COLLECTION in 'to'
      const toRecipients = deleteActivity!.activity.toIds
      expect(toRecipients).toBeDefined()

      const toUrls: string[] = []
      for await (const url of toRecipients!) {
        toUrls.push(url.href)
      }
      expect(toUrls).toContain(PUBLIC_COLLECTION.href)
    })

    it('should skip delete for collections without a converter', async () => {
      const federation = createFederation<void>({
        contextData: undefined,
        origin: 'https://ap.example',
      })
      federation.setActorDispatcher('/users/{identifier}', () => null)

      const pdsClient = createMockPdsClient()

      const bridgeAccount = createMockBridgeAccount({
        isAvailable: jest.fn().mockReturnValue(true),
        _did: 'did:plc:bridge',
      })

      const mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          pds: { url: 'https://pds.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      const processor = new FirehoseProcessor(mockCtx)
      const processCommit = (processor as any).processCommit.bind(processor)

      // Delete for a collection without a converter
      await processCommit({
        repo: testData.users.alice.did,
        ops: [
          {
            action: 'delete',
            path: 'app.bsky.graph.follow/xyz789',
          },
        ],
        seq: 1,
      })

      // Verify no activity was sent
      const sentActivities = federation.sentActivities
      expect(sentActivities).toHaveLength(0)
    })

    it('should skip delete from bridge account', async () => {
      const bridgeDid = 'did:plc:bridge'
      const federation = createFederation<void>({
        contextData: undefined,
        origin: 'https://ap.example',
      })
      federation.setActorDispatcher('/users/{identifier}', () => null)
      federation.setObjectDispatcher(Note, '/posts/{uri}', () => null)

      const pdsClient = createMockPdsClient()

      const bridgeAccount = createMockBridgeAccount({
        isAvailable: jest.fn().mockReturnValue(true),
        _did: bridgeDid,
      })

      const mockCtx = {
        db,
        pdsClient,
        bridgeAccount,
        federation,
        cfg: {
          service: { publicUrl: 'https://ap.example' },
          pds: { url: 'https://pds.example' },
          bridge: { handle: 'bridge.test' },
        },
      } as unknown as AppContext

      const processor = new FirehoseProcessor(mockCtx)
      const processCommit = (processor as any).processCommit.bind(processor)

      // Delete from the bridge account
      await processCommit({
        repo: bridgeDid,
        ops: [
          {
            action: 'delete',
            path: 'app.bsky.feed.post/bridgepost123',
          },
        ],
        seq: 1,
      })

      // Verify no activity was sent
      const sentActivities = federation.sentActivities
      expect(sentActivities).toHaveLength(0)
    })
  })
})
