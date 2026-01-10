# Plan: Extract ActivityPub Federation to `@atproto/activitypub` Sidecar Service

## Overview

Create a new standalone package `packages/activitypub/` that runs as a sidecar service alongside the PDS, handling all ActivityPub federation. It will:

1. **Use the PDS XRPC API** for all data access (profiles, posts, blobs) via the `@atproto/api` client
2. **Authenticate with admin token** to access PDS APIs
3. **Maintain its own SQLite database** for AP-specific data (followers, keypairs)
4. **Subscribe to `com.atproto.sync.subscribeRepos`** to detect new posts and deliver them to AP followers
5. **Expose ActivityPub endpoints** (actors, inboxes, outbox, etc.) that PDS will proxy/redirect to

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Internet                                   │
└─────────────────────────────────────────────────────────────────────┘
                    │                          │
                    ▼                          ▼
         ┌──────────────────┐       ┌────────────────────┐
         │    PDS Server    │       │  AP Federation     │
         │  (port 2583)     │       │  Sidecar (port X)  │
         │                  │       │                    │
         │ - XRPC endpoints │◀──────│ - Actor endpoints  │
         │ - subscribeRepos │       │ - Inbox/Outbox     │
         │ - uploadBlob     │       │ - WebFinger        │
         │ - createRecord   │       │                    │
         └──────────────────┘       └────────────────────┘
                    │                          │
                    │                          │
                    ▼                          ▼
         ┌──────────────────┐       ┌────────────────────┐
         │  Per-user SQLite │       │  AP SQLite DB      │
         │  Actor Stores    │       │  - ap_follow       │
         │  (existing)      │       │  - ap_key_pair     │
         └──────────────────┘       │  - ap_delivery_q   │
                                    └────────────────────┘
```

---

## Current State (This Branch)

The branch implements ActivityPub federation **tightly coupled to the PDS** with these components:

### Files in `packages/pds/src/activitypub/`:

1. **`federation.ts`** (764 lines) - Core Fedify integration:

   - Actor dispatcher (`/users/{+identifier}`)
   - Handle mapping
   - KeyPairs dispatcher (RSA + Ed25519)
   - Followers/Following dispatchers
   - Inbox listeners (Follow, Undo, Create)
   - Outbox dispatcher
   - Object dispatcher for Notes

2. **`outbox.ts`** (140 lines) - Listens to sequencer events and delivers activities to followers

3. **`conversion/`** - Record converters:

   - `registry.ts` - Generic converter interface
   - `post.ts` - Post ↔ Note conversion
   - `html-parser.ts` - HTML to plain text
   - `blob-downloader.ts` - Remote media handling

4. **Actor Store extensions** - Per-user SQLite tables:
   - `activitypub_follow` - AP followers tracking
   - `activitypub_key_pair` - RSA/Ed25519 keypairs

### Key Dependencies on PDS Internals:

- `AppContext` (account manager, actor store, sequencer, etc.)
- `ActorStore.read()` / `ActorStore.transact()`
- `AccountManager.getAccount()` / `getAccountCount()`
- `Sequencer` for listening to new commits
- `LocalViewer` for image URLs
- Direct repo access for creating reply posts from AP

---

## Design Decisions

| Decision        | Choice                             |
| --------------- | ---------------------------------- |
| Package name    | `@atproto/activitypub`             |
| Auth method     | Admin token / shared secret        |
| AP data storage | Dedicated SQLite database          |
| Blob handling   | Delegate to PDS via uploadBlob API |
| Reply posts     | Create via PDS createRecord API    |
| Migration       | No migration needed (fresh start)  |

---

## Phase 1: Create Package Structure

### 1.1 Directory Structure

```
packages/activitypub/
├── package.json          # @atproto/activitypub
├── tsconfig.json
├── tsconfig.build.json
├── jest.config.js
├── src/
│   ├── index.ts          # Main entry, exports APFederationService
│   ├── config.ts         # Configuration (PDS URL, admin token, port, etc.)
│   ├── context.ts        # AppContext with dependencies
│   ├── logger.ts         # Logging setup
│   ├── error.ts          # Error handlers
│   │
│   ├── db/               # SQLite database
│   │   ├── index.ts
│   │   ├── schema/
│   │   │   ├── follow.ts
│   │   │   ├── key-pair.ts
│   │   │   └── delivery-queue.ts  # For failed delivery retries
│   │   └── migrations/
│   │       └── 001-init.ts
│   │
│   ├── pds-client/       # Wrapper around @atproto/api for PDS access
│   │   ├── index.ts
│   │   ├── account.ts    # Get accounts, profiles
│   │   ├── records.ts    # createRecord, getRecord
│   │   └── blobs.ts      # uploadBlob
│   │
│   ├── federation/       # Fedify setup and dispatchers
│   │   ├── index.ts      # createFederation, createRouter
│   │   ├── actor.ts      # Actor dispatcher
│   │   ├── inbox.ts      # Inbox listeners (Follow, Undo, Create)
│   │   ├── outbox.ts     # Outbox dispatcher
│   │   ├── followers.ts  # Followers collection
│   │   ├── following.ts  # Following collection
│   │   ├── keypairs.ts   # Keypair management
│   │   └── nodeinfo.ts   # NodeInfo dispatcher
│   │
│   ├── conversion/       # Move from PDS with minimal changes
│   │   ├── index.ts
│   │   ├── registry.ts
│   │   ├── post.ts
│   │   ├── html-parser.ts
│   │   └── blob-handler.ts  # Updated to use PDS API for uploads
│   │
│   └── firehose/         # subscribeRepos consumer
│       ├── index.ts
│       └── processor.ts  # Process commits, deliver to AP followers
│
└── tests/
    ├── federation.test.ts
    ├── inbox.test.ts
    └── _util.ts
```

### 1.2 Dependencies (`package.json`)

```json
{
  "name": "@atproto/activitypub",
  "version": "0.0.1",
  "description": "ActivityPub federation sidecar for ATProto PDS",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "@atproto/api": "workspace:*",
    "@atproto/common": "workspace:*",
    "@atproto/syntax": "workspace:*",
    "@atproto/lexicon": "workspace:*",
    "@fedify/fedify": "^1.4.5",
    "@fedify/express": "^0.2.0",
    "@js-temporal/polyfill": "^0.4.4",
    "better-sqlite3": "^11.0.0",
    "express": "^4.21.0",
    "html-to-text": "^9.0.5",
    "kysely": "^0.26.3",
    "pino": "^8.0.0",
    "pino-http": "^8.0.0"
  },
  "devDependencies": {
    "@atproto/dev-env": "workspace:*"
  }
}
```

---

## Phase 2: Core Components

### 2.1 Configuration (`config.ts`)

```typescript
export interface APFederationConfig {
  service: {
    port: number
    publicUrl: string // e.g., https://mypds.example.com
    hostname: string
  }
  pds: {
    url: string // e.g., http://localhost:2583
    adminToken: string // Shared secret for auth
  }
  db: {
    location: string // Path to SQLite database
  }
  firehose: {
    enabled: boolean
    cursor?: number // Resume from cursor
  }
}

export interface APFederationSecrets {
  adminToken: string
}
```

### 2.2 PDS Client (`pds-client/index.ts`)

Wraps `@atproto/api` with admin auth:

```typescript
import { AtpAgent } from '@atproto/api'

export class PDSClient {
  private agent: AtpAgent

  constructor(pdsUrl: string, adminToken: string) {
    this.agent = new AtpAgent({ service: pdsUrl })
    // Set admin auth header
    const credentials = Buffer.from(`admin:${adminToken}`).toString('base64')
    this.agent.api.setHeader('authorization', `Basic ${credentials}`)
  }

  // Account operations
  async getAccount(handleOrDid: string): Promise<AccountInfo | null> {
    // Use com.atproto.admin.getAccountInfo or similar
  }

  async getAccounts(dids: string[]): Promise<Map<string, AccountInfo>> {
    // Use com.atproto.admin.getAccountInfos
  }

  async getAccountCount(): Promise<number> {
    // May need new endpoint or use listRepos count
  }

  // Profile operations
  async getProfile(did: string): Promise<ProfileRecord | null> {
    const res = await this.agent.com.atproto.repo.getRecord({
      repo: did,
      collection: 'app.bsky.actor.profile',
      rkey: 'self',
    })
    return res.data.value
  }

  // Record operations
  async createRecord(did: string, collection: string, record: unknown) {
    return this.agent.com.atproto.repo.createRecord({
      repo: did,
      collection,
      record,
    })
  }

  async getRecord(did: string, collection: string, rkey: string) {
    return this.agent.com.atproto.repo.getRecord({
      repo: did,
      collection,
      rkey,
    })
  }

  async listRecords(did: string, collection: string, opts?: ListRecordsOpts) {
    return this.agent.com.atproto.repo.listRecords({
      repo: did,
      collection,
      ...opts,
    })
  }

  // Blob operations
  async uploadBlob(did: string, data: Uint8Array, mimeType: string) {
    // May need to authenticate as the user or use admin endpoint
    return this.agent.com.atproto.repo.uploadBlob(data, { encoding: mimeType })
  }

  // Image URL construction
  getBlobUrl(did: string, cid: string): string {
    return `${this.pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`
  }
}
```

### 2.3 Database Schema

```typescript
// db/schema/follow.ts
export interface APFollow {
  userDid: string // The local user being followed
  activityId: string // AP activity ID
  actorUri: string // Remote follower's actor URI
  actorInbox: string // Remote follower's inbox
  createdAt: string
}

export const tableName = 'ap_follow'

// db/schema/key-pair.ts
export interface APKeyPair {
  userDid: string
  type: 'RSASSA-PKCS1-v1_5' | 'Ed25519'
  publicKey: string // JWK JSON
  privateKey: string // JWK JSON
  createdAt: string
}

export const tableName = 'ap_key_pair'

// db/schema/delivery-queue.ts (for retry logic)
export interface APDeliveryJob {
  id: number
  userDid: string
  activityJson: string
  targetInbox: string
  attempts: number
  lastError: string | null
  nextAttempt: string
  createdAt: string
}

export const tableName = 'ap_delivery_queue'
```

### 2.4 Database Migration (`db/migrations/001-init.ts`)

```typescript
import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ap_follow')
    .addColumn('userDid', 'text', (col) => col.notNull())
    .addColumn('activityId', 'text', (col) => col.notNull())
    .addColumn('actorUri', 'text', (col) => col.notNull())
    .addColumn('actorInbox', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('ap_follow_pkey', ['userDid', 'actorUri'])
    .execute()

  await db.schema
    .createIndex('ap_follow_user_did_idx')
    .on('ap_follow')
    .column('userDid')
    .execute()

  await db.schema
    .createTable('ap_key_pair')
    .addColumn('userDid', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('publicKey', 'text', (col) => col.notNull())
    .addColumn('privateKey', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('ap_key_pair_pkey', ['userDid', 'type'])
    .execute()

  await db.schema
    .createTable('ap_delivery_queue')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('userDid', 'text', (col) => col.notNull())
    .addColumn('activityJson', 'text', (col) => col.notNull())
    .addColumn('targetInbox', 'text', (col) => col.notNull())
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('lastError', 'text')
    .addColumn('nextAttempt', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('ap_delivery_queue_next_attempt_idx')
    .on('ap_delivery_queue')
    .column('nextAttempt')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ap_delivery_queue').execute()
  await db.schema.dropTable('ap_key_pair').execute()
  await db.schema.dropTable('ap_follow').execute()
}
```

### 2.5 Firehose Consumer (`firehose/processor.ts`)

```typescript
import { Subscription } from '@atproto/xrpc-server'
import {
  isCommit,
  OutputSchema as RepoEvent,
} from '@atproto/api/src/client/types/com/atproto/sync/subscribeRepos'
import { AppContext } from '../context'
import { RecordConverterRegistry } from '../conversion'

export class FirehoseProcessor {
  private subscription: Subscription<RepoEvent> | null = null

  constructor(
    private ctx: AppContext,
    private converterRegistry: RecordConverterRegistry,
  ) {}

  async start() {
    const url = new URL(this.ctx.cfg.pds.url)
    const wsUrl = `ws://${url.host}/xrpc/com.atproto.sync.subscribeRepos`

    this.subscription = new Subscription({
      service: wsUrl,
      method: 'com.atproto.sync.subscribeRepos',
      getParams: () => ({ cursor: this.ctx.cfg.firehose.cursor }),
      validate: (value: unknown) => value as RepoEvent,
    })

    for await (const event of this.subscription) {
      if (isCommit(event)) {
        await this.processCommit(event)
      }
    }
  }

  private async processCommit(event: CommitEvent) {
    for (const op of event.ops) {
      if (op.action !== 'create') continue

      const collection = op.path.split('/')[0]
      const converter = this.converterRegistry.get(collection)
      if (!converter) continue

      try {
        // Get the record from PDS
        const record = await this.ctx.pdsClient.getRecord(
          event.repo,
          collection,
          op.path.split('/')[1],
        )

        // Convert to AP activity
        const result = await converter.toActivityPub(
          this.ctx.federationContext,
          event.repo,
          record,
        )

        if (result?.activity) {
          await this.deliverToFollowers(event.repo, result.activity)
        }
      } catch (err) {
        this.ctx.logger.warn(
          { err, repo: event.repo, path: op.path },
          'failed to process commit for AP delivery',
        )
      }
    }
  }

  private async deliverToFollowers(userDid: string, activity: Activity) {
    const followers = await this.ctx.db.getFollowers(userDid)

    for (const follower of followers) {
      try {
        await this.ctx.federation.sendActivity(
          { identifier: userDid },
          {
            id: new URL(follower.actorUri),
            inboxId: new URL(follower.actorInbox),
          },
          activity,
        )
      } catch (err) {
        // Queue for retry
        await this.ctx.db.queueDelivery({
          userDid,
          activityJson: JSON.stringify(activity),
          targetInbox: follower.actorInbox,
          nextAttempt: new Date(Date.now() + 60000).toISOString(),
        })
      }
    }
  }

  async stop() {
    this.subscription?.abort()
  }
}
```

---

## Phase 3: Federation Endpoints

### 3.1 Module Mapping

The current `federation.ts` will be split into focused modules:

| Current location     | New location              | Changes needed                                              |
| -------------------- | ------------------------- | ----------------------------------------------------------- |
| Actor dispatcher     | `federation/actor.ts`     | Use `PDSClient.getProfile()` instead of `actorStore.read()` |
| Handle mapping       | `federation/actor.ts`     | Use `PDSClient.getAccount()`                                |
| KeyPairs dispatcher  | `federation/keypairs.ts`  | Use local SQLite DB                                         |
| Followers dispatcher | `federation/followers.ts` | Use local SQLite DB                                         |
| Following dispatcher | `federation/following.ts` | Call `PDSClient.listRecords()`                              |
| Inbox listeners      | `federation/inbox.ts`     | Use `PDSClient.createRecord()` for replies                  |
| Outbox dispatcher    | `federation/outbox.ts`    | Use `PDSClient.listRecords()` + `getRecord()`               |
| Object dispatcher    | `federation/outbox.ts`    | Use `PDSClient.getRecord()`                                 |
| NodeInfo             | `federation/nodeinfo.ts`  | Use `PDSClient.getAccountCount()`                           |

### 3.2 Actor Dispatcher (`federation/actor.ts`)

```typescript
import {
  Person,
  Image,
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
} from '@fedify/fedify'
import { AppContext } from '../context'

export function setupActorDispatcher(ctx: AppContext) {
  ctx.federation
    .setActorDispatcher('/users/{+identifier}', async (fedCtx, identifier) => {
      // Validate identifier
      if (identifier.includes('/')) return null

      // Get account from PDS
      const account = await ctx.pdsClient.getAccount(identifier)
      if (!account?.handle) return null

      // Get profile from PDS
      const profile = await ctx.pdsClient.getProfile(identifier)

      // Get keypairs
      const keyPairs = await fedCtx.getActorKeyPairs(identifier)

      return new Person({
        id: fedCtx.getActorUri(identifier),
        name: profile?.displayName,
        summary: profile?.description,
        preferredUsername: account.handle.split('.')[0],
        icon: profile?.avatar
          ? new Image({
              url: new URL(profile.avatar),
              mediaType: 'image/jpeg', // or detect from URL
            })
          : undefined,
        url: new URL(`https://bsky.app/profile/${account.handle}`),
        inbox: fedCtx.getInboxUri(identifier),
        outbox: fedCtx.getOutboxUri(identifier),
        followers: fedCtx.getFollowersUri(identifier),
        following: fedCtx.getFollowingUri(identifier),
        publicKey: keyPairs[0].cryptographicKey,
        assertionMethods: keyPairs.map((kp) => kp.multikey),
      })
    })
    .mapHandle(async (fedCtx, username) => {
      const hostname = ctx.cfg.service.hostname
      const handle = `${username}.${hostname === 'localhost' ? 'test' : hostname}`
      const account = await ctx.pdsClient.getAccount(handle)
      return account?.did ?? null
    })
    .setKeyPairsDispatcher(async (fedCtx, identifier) => {
      // Check local DB for existing keypairs
      let rsaKeypair = await ctx.db.getKeyPair(identifier, 'RSASSA-PKCS1-v1_5')
      let ed25519Keypair = await ctx.db.getKeyPair(identifier, 'Ed25519')

      // Generate if missing
      if (!rsaKeypair) {
        const { publicKey, privateKey } =
          await generateCryptoKeyPair('RSASSA-PKCS1-v1_5')
        rsaKeypair = await ctx.db.createKeyPair({
          userDid: identifier,
          type: 'RSASSA-PKCS1-v1_5',
          publicKey: JSON.stringify(await exportJwk(publicKey)),
          privateKey: JSON.stringify(await exportJwk(privateKey)),
          createdAt: new Date().toISOString(),
        })
      }

      if (!ed25519Keypair) {
        const { publicKey, privateKey } = await generateCryptoKeyPair('Ed25519')
        ed25519Keypair = await ctx.db.createKeyPair({
          userDid: identifier,
          type: 'Ed25519',
          publicKey: JSON.stringify(await exportJwk(publicKey)),
          privateKey: JSON.stringify(await exportJwk(privateKey)),
          createdAt: new Date().toISOString(),
        })
      }

      // Import and return
      return Promise.all(
        [rsaKeypair, ed25519Keypair].map(async (kp) => ({
          privateKey: await importJwk(JSON.parse(kp.privateKey), 'private'),
          publicKey: await importJwk(JSON.parse(kp.publicKey), 'public'),
        })),
      )
    })
}
```

### 3.3 Inbox Handlers (`federation/inbox.ts`)

```typescript
import { Accept, Create, Follow, Note, Undo } from '@fedify/fedify'
import { AppContext } from '../context'
import { postConverter } from '../conversion'

export function setupInboxListeners(ctx: AppContext) {
  ctx.federation
    .setInboxListeners('/users/{+identifier}/inbox', '/inbox')

    // Handle Follow requests
    .on(Follow, async (fedCtx, follow) => {
      if (!follow.id || !follow.actorId || !follow.objectId) return

      const parsed = fedCtx.parseUri(follow.objectId)
      if (parsed?.type !== 'actor') return

      const follower = await follow.getActor()
      if (!follower?.id || !follower.inboxId) return

      // Store follow in local DB
      await ctx.db.createFollow({
        userDid: parsed.identifier,
        activityId: follow.id.href,
        actorUri: follower.id.href,
        actorInbox: follower.inboxId.href,
        createdAt: new Date().toISOString(),
      })

      // Send Accept
      await fedCtx.sendActivity(
        { identifier: parsed.identifier },
        follower,
        new Accept({ actor: follow.objectId, object: follow }),
      )
    })

    // Handle Undo (unfollow)
    .on(Undo, async (fedCtx, undo) => {
      const object = await undo.getObject()
      if (!(object instanceof Follow)) return
      if (!undo.actorId || !object.objectId) return

      const parsed = fedCtx.parseUri(object.objectId)
      if (!parsed || parsed.type !== 'actor') return

      await ctx.db.deleteFollow(parsed.identifier, undo.actorId.href)
    })

    // Handle Create (replies from remote)
    .on(Create, async (fedCtx, create) => {
      const object = await create.getObject()
      if (!(object instanceof Note)) return

      const replyTargetId = object.replyTargetId
      if (!replyTargetId) return

      // Check if reply target is local
      const parsed = fedCtx.parseUri(replyTargetId)
      if (!parsed || parsed.type !== 'object') return

      // Extract target user and post
      const urlPath = replyTargetId.pathname
      const postUri = urlPath.slice(urlPath.indexOf('posts/') + 'posts/'.length)
      const { AtUri } = await import('@atproto/syntax')
      const postAtUri = new AtUri(postUri)
      const postAuthorDid = postAtUri.host

      // Verify user exists
      const account = await ctx.pdsClient.getAccount(postAuthorDid)
      if (!account) return

      // Get actor info for attribution
      const actor = await create.getActor()
      const actorHandle = actor?.preferredUsername?.toString() ?? 'unknown'
      const actorId = actor?.id
      const fullHandle = actorId
        ? `@${actorHandle}@${actorId.hostname}`
        : actorHandle

      // Convert Note to post record
      const convertedRecord = await postConverter.toRecord(
        fedCtx,
        postAuthorDid,
        object,
        { pdsClient: ctx.pdsClient }, // For blob uploads
      )

      if (!convertedRecord) return

      // Get parent post to build reply chain
      const parentRecord = await ctx.pdsClient.getRecord(
        postAuthorDid,
        'app.bsky.feed.post',
        postAtUri.rkey,
      )

      if (!parentRecord) return

      // Build reply reference
      const parentRef = { uri: postAtUri.toString(), cid: parentRecord.cid }
      const parentValue = parentRecord.value as {
        reply?: { root: { uri: string; cid: string } }
      }
      const rootRef = parentValue.reply?.root ?? parentRef

      convertedRecord.value.reply = { root: rootRef, parent: parentRef }

      // Prepend attribution
      convertedRecord.value.text = `${fullHandle} replied:\n\n${convertedRecord.value.text}`

      // Create post via PDS API
      await ctx.pdsClient.createRecord(
        postAuthorDid,
        'app.bsky.feed.post',
        convertedRecord.value,
      )
    })
}
```

### 3.4 Followers Dispatcher (`federation/followers.ts`)

```typescript
import { Temporal } from '@js-temporal/polyfill'
import { AppContext } from '../context'

export function setupFollowersDispatcher(ctx: AppContext) {
  ctx.federation
    .setFollowersDispatcher(
      '/users/{+identifier}/followers',
      async (fedCtx, identifier, cursor) => {
        const { follows, nextCursor } = await ctx.db.getFollows({
          userDid: identifier,
          cursor,
          limit: 50,
        })

        return {
          items: follows.map((f) => ({
            id: new URL(f.actorUri),
            inboxId: new URL(f.actorInbox),
          })),
          nextCursor,
        }
      },
    )
    .setCounter(async (fedCtx, identifier) => {
      return ctx.db.getFollowsCount(identifier)
    })
    .setFirstCursor(() =>
      Temporal.Now.zonedDateTimeISO('UTC').add({ days: 1 }).toString(),
    )
}
```

### 3.5 Outbox Dispatcher (`federation/outbox.ts`)

```typescript
import { AtUri } from '@atproto/syntax'
import { AppContext } from '../context'
import { recordConverterRegistry } from '../conversion'

export function setupOutboxDispatcher(ctx: AppContext) {
  ctx.federation
    .setOutboxDispatcher(
      '/users/{+identifier}/outbox',
      async (fedCtx, identifier, cursor) => {
        const limit = 50

        // Get records from PDS
        const collections = recordConverterRegistry
          .getAll()
          .map((c) => c.collection)

        // Fetch records from each collection
        const allRecords = []
        for (const collection of collections) {
          const res = await ctx.pdsClient.listRecords(identifier, collection, {
            limit: limit + 1,
            cursor: cursor ?? undefined,
            reverse: true,
          })
          allRecords.push(...res.records.map((r) => ({ ...r, collection })))
        }

        // Sort by creation time (rkey is a TID)
        allRecords.sort((a, b) => {
          const aRkey = new AtUri(a.uri).rkey
          const bRkey = new AtUri(b.uri).rkey
          return bRkey.localeCompare(aRkey) // descending
        })

        // Paginate
        const records = allRecords.slice(0, limit + 1)
        let nextCursor: string | null = null
        if (records.length > limit) {
          records.pop()
          const lastRecord = records[records.length - 1]
          nextCursor = new AtUri(lastRecord.uri).rkey
        }

        // Convert to activities
        const items = await Promise.all(
          records.map(async (record) => {
            const converter = recordConverterRegistry.get(record.collection)
            if (!converter) return null

            const result = await converter.toActivityPub(
              fedCtx,
              identifier,
              record,
            )
            return result?.activity ?? null
          }),
        )

        return {
          items: items.filter((i) => i !== null),
          nextCursor,
        }
      },
    )
    .setCounter(async (fedCtx, identifier) => {
      let total = 0
      for (const converter of recordConverterRegistry.getAll()) {
        const res = await ctx.pdsClient.listRecords(
          identifier,
          converter.collection,
          {
            limit: 1,
          },
        )
        // Note: This is inefficient. May need a count endpoint.
        total += res.records.length > 0 ? 100 : 0 // Approximate
      }
      return total
    })
    .setFirstCursor(() => '')
}
```

---

## Phase 4: PDS Integration

### 4.1 PDS Changes Required

The PDS needs minimal changes to support the sidecar:

#### Option A: Reverse Proxy (Recommended)

Use nginx, caddy, or similar to route AP requests:

```nginx
# nginx.conf
location ~ ^/(users|inbox|\.well-known/webfinger|\.well-known/nodeinfo|nodeinfo) {
    proxy_pass http://localhost:3000;  # AP sidecar
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location / {
    proxy_pass http://localhost:2583;  # PDS
}
```

#### Option B: PDS Proxy Middleware

Add middleware to PDS that proxies AP routes to sidecar:

```typescript
// packages/pds/src/activitypub-proxy.ts
import { createProxyMiddleware } from 'http-proxy-middleware'

export function createAPProxy(sidecarUrl: string) {
  return createProxyMiddleware({
    target: sidecarUrl,
    changeOrigin: true,
    pathFilter: ['/users', '/inbox', '/.well-known/webfinger', '/nodeinfo'],
  })
}

// In index.ts
if (ctx.cfg.activitypub?.sidecarUrl) {
  app.use(createAPProxy(ctx.cfg.activitypub.sidecarUrl))
}
```

### 4.2 PDS API Additions (If Needed)

May need to add or expose admin endpoints:

1. **`com.atproto.admin.getAccountInfo`** - Already exists
2. **`com.atproto.admin.getAccountInfos`** - Already exists
3. **Account count** - May need new endpoint or use `listRepos` with counting

### 4.3 PDS Cleanup (After Migration)

Once sidecar is working, remove from PDS:

```
DELETE: packages/pds/src/activitypub/
DELETE: packages/pds/src/actor-store/activitypub/
DELETE: packages/pds/src/actor-store/db/migrations/002-activitypub.ts
DELETE: packages/pds/src/actor-store/db/schema/activitypub/
DELETE: packages/pds/tests/activitypub/
MODIFY: packages/pds/src/index.ts  # Remove AP imports and routes
MODIFY: packages/pds/src/context.ts  # Remove federation from AppContext
MODIFY: packages/pds/package.json  # Remove @fedify/* dependencies
```

---

## Phase 5: Implementation Order

| Step | Task                           | Files                                     | Estimated Effort |
| ---- | ------------------------------ | ----------------------------------------- | ---------------- |
| 1    | Create package skeleton        | `package.json`, tsconfig, basic structure | 1 hour           |
| 2    | Implement database layer       | `db/`, schema, migrations, CRUD           | 2 hours          |
| 3    | Implement PDS client           | `pds-client/` with admin auth             | 2 hours          |
| 4    | Port conversion code           | `conversion/` adapted for PDS API         | 1 hour           |
| 5    | Implement federation/actor     | Actor + keypair dispatchers               | 2 hours          |
| 6    | Implement federation/followers | Followers/following collections           | 1 hour           |
| 7    | Implement federation/inbox     | Follow/Undo handlers                      | 1 hour           |
| 8    | Implement federation/outbox    | Outbox + object dispatchers               | 2 hours          |
| 9    | Implement nodeinfo             | NodeInfo dispatcher                       | 30 min           |
| 10   | Implement firehose consumer    | `firehose/` + delivery logic              | 3 hours          |
| 11   | Implement reply handling       | Inbox Create + PDS createRecord           | 2 hours          |
| 12   | Add main service class         | `index.ts` with start/stop                | 1 hour           |
| 13   | Add PDS proxy/config           | PDS middleware or nginx config            | 1 hour           |
| 14   | Write tests                    | Port + new tests                          | 3 hours          |
| 15   | Remove AP code from PDS        | Cleanup PDS package                       | 2 hours          |

**Total estimated effort: ~24 hours**

---

## Potential Issues and Mitigations

### Issue 1: Admin token security

**Risk:** Admin token could be compromised, giving full PDS access.

**Mitigation:**

- Use a unique, long random token
- Consider adding a dedicated "federation service" role with limited permissions
- Rate limit the sidecar's IP
- Run sidecar on same host/network as PDS

### Issue 2: PDS API limitations

**Risk:** Some operations may not be available via public API.

**Mitigation:**

- Add admin-only endpoints as needed
- For blob URLs, construct them using known patterns
- For account counts, use listRepos with counting

### Issue 3: Image URL generation

**Risk:** Sidecar doesn't have access to LocalViewer for image URLs.

**Mitigation:**

- Use direct blob URLs: `{pdsUrl}/xrpc/com.atproto.sync.getBlob?did={did}&cid={cid}`
- Or configure image service URL in sidecar config

### Issue 4: Record creation authentication

**Risk:** Creating records on behalf of users requires proper auth.

**Mitigation:**

- Use admin auth which should bypass user auth checks
- Verify PDS allows admin to create records for any user
- Add `x-ap-federation-service` header for audit trail

### Issue 5: Delivery failures and retries

**Risk:** Remote servers may be down, causing lost deliveries.

**Mitigation:**

- Implement `ap_delivery_queue` table for retry logic
- Exponential backoff (1min, 5min, 30min, 2hr, 12hr)
- Max 10 attempts before giving up
- Background worker to process queue

---

## Testing Strategy

### Unit Tests

- Database operations (CRUD for follows, keypairs)
- Conversion functions (post ↔ Note)
- PDS client (mock responses)

### Integration Tests

- Full flow with test PDS
- Follow/unfollow cycle
- Post creation → AP delivery
- Incoming reply → record creation

### E2E Tests

- Federation with actual Mastodon instance (manual)
- WebFinger resolution
- Actor discovery
- Activity delivery

---

## Configuration Example

```env
# AP Federation Sidecar
AP_PORT=3000
AP_PUBLIC_URL=https://mypds.example.com
AP_HOSTNAME=mypds.example.com

# PDS Connection
PDS_URL=http://localhost:2583
PDS_ADMIN_TOKEN=your-secret-admin-token

# Database
AP_DB_LOCATION=/var/lib/ap-federation/data.sqlite

# Firehose
AP_FIREHOSE_ENABLED=true
AP_FIREHOSE_CURSOR=0
```

---

## Success Criteria

1. All existing ActivityPub tests pass against sidecar
2. Can follow/unfollow from Mastodon
3. Posts appear in Mastodon timeline
4. Replies from Mastodon create posts in user's repo
5. PDS codebase is cleaner without AP code
6. Sidecar can be deployed/updated independently
