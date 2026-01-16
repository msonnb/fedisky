# Fedisky

An ActivityPub federation sidecar for ATProto PDS. Fedisky bridges Bluesky with the Fediverse, allowing ATProto users to be followed by and interact with users on Mastodon and other ActivityPub-compatible platforms.

## Features

- **Outbound federation**: Bluesky posts are automatically converted to ActivityPub activities and delivered to Fediverse followers
- **Inbound federation**: ActivityPub users can follow Bluesky accounts and reply to posts, with replies bridged back into Bluesky
- **Real-time sync**: Subscribes to the PDS firehose for instant post propagation
- **Media support**: Handles embedded images and videos

## Requirements

- Node.js >= 22.0.0
- pnpm
- Access to an ATProto PDS with admin credentials

## Installation

```bash
pnpm install
pnpm build
```

## Configuration

| Variable              | Required | Description                                |
| --------------------- | -------- | ------------------------------------------ |
| `PDS_URL`             | Yes      | URL of the ATProto PDS                     |
| `PDS_ADMIN_TOKEN`     | Yes      | Admin token for PDS                        |
| `AP_PORT`             | No       | Port for the service (default: 2588)       |
| `AP_HOSTNAME`         | No       | Public hostname for the service            |
| `AP_DB_LOCATION`      | No       | SQLite database path (default: `:memory:`) |
| `AP_FIREHOSE_ENABLED` | No       | Enable firehose processing (default: true) |
| `AP_BRIDGE_HANDLE`    | No       | Handle for the bridge account              |

## Usage

```bash
node dist/index.js
```

The service exposes a health check endpoint at `GET /health`.

## How It Works

Fedisky runs alongside your ATProto PDS and:

1. Exposes ATProto users as ActivityPub actors with proper WebFinger discovery
2. Listens to the PDS firehose for new posts and converts them to ActivityPub `Note` objects
3. Delivers activities to Fediverse followers via their inboxes
4. Accepts incoming `Follow` requests from ActivityPub users
5. Uses a "bridge account" to post Fediverse replies back into Bluesky

## License

MIT
