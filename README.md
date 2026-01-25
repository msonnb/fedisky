# Fedisky

An ActivityPub federation sidecar for ATProto PDS. Fedisky bridges Bluesky with the Fediverse, allowing ATProto users to be followed by and interact with users on Mastodon and other ActivityPub-compatible platforms.

## Features

### Outbound Federation (Bluesky → Fediverse)

- **Posts**: Bluesky posts are converted to ActivityPub `Note` objects and delivered to followers
- **Replies**: Reply threading is preserved with proper `inReplyTo` references
- **Likes**: Likes on local posts generate ActivityPub `Like` activities
- **Reposts**: Reposts of local posts generate ActivityPub `Announce` activities
- **Deletions**: Post deletions and undo operations are federated

### Inbound Federation (Fediverse → Bluesky)

- **Follows**: ActivityPub users can follow Bluesky accounts
- **Replies**: Replies to Bluesky posts are bridged back via a dedicated bridge account with author attribution

### Media Support

- Images (up to 4 per post) with alt text
- Videos (1 per post)
- Remote media is downloaded and re-uploaded to the PDS (max 10MB)

### Rich Text

- Mentions are converted between formats (only local PDS users)
- Links are preserved as proper HTML anchors
- Language tags are carried through federation

## Requirements

- An existing Bluesky PDS installation (via the [official installer](https://github.com/bluesky-social/pds))
- Docker

## Installation

### Quick Install (Recommended)

If you have a PDS installed via the official Bluesky installer, run:

```bash
curl -fsSL https://raw.githubusercontent.com/msonnb/fedisky/main/fedisky-installer.sh | sudo bash
```

The installer will:

1. Detect your existing PDS configuration
2. Prompt for ActivityPub-specific settings (hostname, bridge account, etc.)
3. Create the ActivityPub sidecar configuration
4. Update Caddy to route ActivityPub traffic
5. Add the sidecar to your Docker Compose setup
6. Restart services

After installation, Mastodon users can find your PDS users by searching for `@username@your-pds-hostname`.

### Manual Installation

For development or custom setups:

**Requirements**: Node.js >= 22.0.0, pnpm

```bash
pnpm install
pnpm build
```

## Configuration

| Variable                 | Required | Default                 | Description                                          |
| ------------------------ | -------- | ----------------------- | ---------------------------------------------------- |
| `PDS_URL`                | Yes      | -                       | URL of the ATProto PDS                               |
| `PDS_ADMIN_TOKEN`        | Yes      | -                       | Admin token for PDS                                  |
| `AP_PORT`                | No       | `2588`                  | Port for the service                                 |
| `AP_HOSTNAME`            | No       | `localhost`             | Public hostname for ActivityPub URLs                 |
| `AP_PUBLIC_URL`          | No       | Derived from hostname   | Explicit public URL override (useful behind proxies) |
| `AP_VERSION`             | No       | `0.0.0`                 | Version reported in NodeInfo                         |
| `AP_DB_LOCATION`         | No       | `:memory:`              | SQLite database path                                 |
| `AP_FIREHOSE_ENABLED`    | No       | `true`                  | Enable firehose processing                           |
| `AP_FIREHOSE_CURSOR`     | No       | -                       | Cursor position to resume firehose from              |
| `AP_BRIDGE_HANDLE`       | No       | `mastodon.{hostname}`   | Handle for the bridge account                        |
| `AP_BRIDGE_DISPLAY_NAME` | No       | `Mastodon Bridge`       | Display name for the bridge account                  |
| `AP_BRIDGE_DESCRIPTION`  | No       | _(default description)_ | Description for the bridge account profile           |

## Usage

### Docker (via installer)

After running the installer, services are managed via systemd:

```bash
# Check status
sudo systemctl status pds

# View logs
sudo docker logs -f activitypub

# Restart
sudo systemctl restart pds
```

### Manual / Programmatic

Fedisky is a library - you need to create a script to start it:

```typescript
import { APFederationService, readEnv, envToConfig } from '@msonnb/fedisky'

const config = envToConfig(readEnv())
const service = await APFederationService.create(config)
await service.start()

// Handle shutdown
process.on('SIGTERM', async () => {
  await service.destroy()
  process.exit(0)
})
```

## Endpoints

### Application

| Endpoint  | Method | Description  |
| --------- | ------ | ------------ |
| `/health` | GET    | Health check |

### ActivityPub / Federation

| Endpoint                 | Description                      |
| ------------------------ | -------------------------------- |
| `/.well-known/webfinger` | WebFinger discovery              |
| `/.well-known/nodeinfo`  | NodeInfo discovery               |
| `/nodeinfo/2.1`          | NodeInfo document                |
| `/users/{did}`           | Actor profile                    |
| `/users/{did}/inbox`     | Per-user inbox                   |
| `/users/{did}/outbox`    | Outbox collection (paginated)    |
| `/users/{did}/followers` | Followers collection (paginated) |
| `/users/{did}/following` | Following collection (paginated) |
| `/inbox`                 | Shared inbox                     |
| `/posts/{uri}`           | Individual Note object           |

## How It Works

Fedisky runs alongside your ATProto PDS and:

1. **Actor Discovery**: Exposes ATProto users as ActivityPub actors via WebFinger (`@handle@hostname`)
2. **Firehose Processing**: Subscribes to the PDS event stream and converts records to ActivityPub activities
3. **Activity Delivery**: Delivers Create, Like, Announce, Delete, and Undo activities to followers' inboxes
4. **Inbox Handling**: Accepts Follow requests and bridges replies back to Bluesky
5. **Bridge Account**: A dedicated ATProto account posts Fediverse replies with attribution back into Bluesky threads

### Bridge Account

The bridge account is automatically created on startup and handles inbound content from the Fediverse. When a Mastodon user replies to a bridged Bluesky post, the bridge account creates a new post with:

- Attribution prefix linking to the original author's profile
- Content converted from HTML to plain text
- Proper reply threading
- Re-uploaded media attachments

## Uninstalling

To remove the ActivityPub sidecar while keeping your PDS:

1. Stop services: `sudo systemctl stop pds`
2. Remove the activitypub service from `/pds/compose.yaml`
3. Restore the original Caddyfile (backups are in `/pds/caddy/etc/caddy/`)
4. Remove ActivityPub data: `sudo rm -rf /pds/activitypub`
5. Restart PDS: `sudo systemctl start pds`

## License

MIT
