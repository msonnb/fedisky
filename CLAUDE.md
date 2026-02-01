# Fedisky

ActivityPub federation sidecar for ATProto PDS (Personal Data Server). Bridges Bluesky with the Fediverse by converting between ATProto records and ActivityPub activities.

## Tech Stack

- **Runtime**: Node.js >=22, TypeScript 5.6 (strict mode, CommonJS)
- **Package Manager**: pnpm 10.28
- **Database**: SQLite via better-sqlite3 + Kysely (type-safe SQL)
- **Web**: Express 4.17
- **Federation**: Fedify 1.10 (ActivityPub framework)
- **ATProto**: @atproto/api, @atproto/repo, @atproto/syntax
- **Testing**: Vitest

## Commands

```bash
pnpm build        # TypeScript compile to dist/
pnpm start        # Run production (requires build first)
pnpm test         # Run unit tests
pnpm test:watch   # Tests in watch mode
pnpm test:e2e     # End-to-end tests
pnpm lint         # ESLint check
pnpm lint:fix     # ESLint autofix
pnpm format       # Prettier format
```

## Project Structure

```
src/
├── index.ts              # Entry point - APFederationService class
├── config.ts             # Environment config (readEnv/envToConfig)
├── context.ts            # AppContext singleton (DI container)
├── bridge-account/       # Bridge account management (Fediverse→Bluesky relay)
├── conversion/           # ATProto ↔ ActivityPub converters
│   ├── registry.ts       # RecordConverterRegistry (polymorphic pattern)
│   ├── post.ts           # Post/Note converter
│   ├── like.ts           # Like converter
│   └── repost.ts         # Repost/Announce converter
├── db/                   # SQLite database layer
│   ├── migrations/       # Numbered migrations (001, 002, ...)
│   └── schema/           # Table definitions (ap_* prefix)
├── federation/           # ActivityPub endpoints (Fedify)
│   ├── actor.ts          # Actor dispatcher
│   ├── inbox.ts          # Shared/per-user inbox handlers
│   ├── outbox.ts         # Outbox collection (paginated)
│   └── nodeinfo.ts       # NodeInfo discovery
├── firehose/             # ATProto event stream processing
│   └── processor.ts      # WebSocket listener for PDS firehose
└── pds-client/           # ATProto PDS API client wrapper
```

## Architecture Patterns

- **Dependency Injection**: `AppContext` singleton holds all services
- **Polymorphic Converters**: `RecordConverter` registry for ATProto record types
- **Service Lifecycle**: `create()` → `start()` → `destroy()` pattern

## Code Conventions

- **TypeScript**: Strict mode, unused vars pattern `_varName`
- **Imports**: Alphabetical, grouped (builtin → external → internal)
- **Logging**: Structured via `subsystemLogger('activitypub')` with context objects
- **Database Tables**: Prefix `ap_` (ap_follow, ap_key_pair, ap_post_mapping)
- **Tests**: Colocated in `tests/` subdirectories (e.g., `src/federation/tests/`)

## RecordConverter Interface

```typescript
interface RecordConverter<T, TObject> {
  collection: string // e.g., 'app.bsky.feed.post'
  toActivityPub(ctx, identifier, record, pdsClient, options?)
  toRecord(ctx, identifier, object, options?)
  objectTypes?: [typeof APObject]
}
```

## URL Patterns

- Actor: `/users/{did}`
- Post: `/posts/{uri}` (uri is percent-encoded AT URI)
- Inbox: `/users/{did}/inbox` or `/inbox` (shared)
- Outbox: `/users/{did}/outbox`

## Key Files

- `src/index.ts` - Main service orchestrator
- `src/context.ts` - Dependency injection container
- `src/firehose/processor.ts` - ATProto event stream processing
- `src/conversion/post.ts` - Bidirectional conversion example
- `src/federation/inbox.ts` - Inbound activity handling
