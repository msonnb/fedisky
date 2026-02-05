import { envBool, envInt, envStr } from '@atproto/common'

export function readEnv() {
  return {
    port: envInt('AP_PORT'),
    hostname: envStr('AP_HOSTNAME'),
    publicUrl: envStr('AP_PUBLIC_URL'),
    version: envStr('AP_VERSION'),
    pdsUrl: envStr('PDS_URL'),
    pdsHostname: envStr('PDS_HOSTNAME'),
    pdsAdminToken: envStr('PDS_ADMIN_TOKEN'),
    dbLocation: envStr('AP_DB_LOCATION'),
    firehoseEnabled: envBool('AP_FIREHOSE_ENABLED'),
    firehoseCursor: envStr('AP_FIREHOSE_CURSOR'),
    mastodonBridgeHandle: envStr('AP_MASTODON_BRIDGE_HANDLE'),
    mastodonBridgeDisplayName: envStr('AP_MASTODON_BRIDGE_DISPLAY_NAME'),
    mastodonBridgeDescription: envStr('AP_MASTODON_BRIDGE_DESCRIPTION'),
    allowPrivateAddress: envBool('AP_ALLOW_PRIVATE_ADDRESS'),
    // Bluesky bridge account config
    blueskyBridgeHandle: envStr('AP_BLUESKY_BRIDGE_HANDLE'),
    blueskyBridgeDisplayName: envStr('AP_BLUESKY_BRIDGE_DISPLAY_NAME'),
    blueskyBridgeDescription: envStr('AP_BLUESKY_BRIDGE_DESCRIPTION'),
    // Constellation config
    constellationUrl: envStr('AP_CONSTELLATION_URL'),
    constellationPollInterval: envInt('AP_CONSTELLATION_POLL_INTERVAL'),
    // AppView config
    appViewUrl: envStr('AP_APPVIEW_URL'),
  }
}

export type ServerEnvironment = Partial<ReturnType<typeof readEnv>>

export interface APFederationConfig {
  service: {
    port: number
    hostname: string
    publicUrl: string
    version?: string
  }
  pds: {
    url: string
    adminToken: string
    hostname: string
  }
  db: {
    location: string
  }
  firehose: {
    enabled: boolean
    cursor?: number
  }
  /** Mastodon bridge account for posting incoming Fediverse replies */
  mastodonBridge: {
    handle: string
    email: string
    displayName: string
    description: string
  }
  /** Bluesky bridge account for federating external Bluesky replies */
  blueskyBridge: {
    handle: string
    email: string
    displayName: string
    description: string
  }
  /** Constellation service for discovering external Bluesky replies */
  constellation: {
    url: string
    pollInterval: number
  }
  /** AppView service URL for fetching public records */
  appView: {
    url: string
  }
  /** Allow fetching private network addresses (for E2E testing only) */
  allowPrivateAddress?: boolean
}

export function envToConfig(env: ServerEnvironment): APFederationConfig {
  const port = env.port ?? 2588
  const hostname = env.hostname ?? 'localhost'
  // Allow explicit override via AP_PUBLIC_URL, otherwise derive from hostname
  const publicUrl =
    env.publicUrl ??
    (hostname === 'localhost'
      ? `http://localhost:${port}`
      : `https://${hostname}`)
  const version = env.version ?? '0.0.0'
  const mastodonBridgeHandle =
    env.mastodonBridgeHandle ??
    `mastodon.${hostname === 'localhost' ? 'test' : hostname}`
  const blueskyBridgeHandle =
    env.blueskyBridgeHandle ??
    `bluesky.${hostname === 'localhost' ? 'test' : hostname}`
  return {
    service: {
      port,
      publicUrl,
      hostname,
      version,
    },
    pds: {
      url: requireEnv('PDS_URL', env.pdsUrl),
      hostname: requireEnv('PDS_HOSTNAME', env.pdsHostname),
      adminToken: requireEnv('PDS_ADMIN_TOKEN', env.pdsAdminToken),
    },
    db: {
      location: env.dbLocation ?? ':memory:',
    },
    firehose: {
      enabled: env.firehoseEnabled ?? true,
      cursor: env.firehoseCursor ? parseInt(env.firehoseCursor, 10) : undefined,
    },
    mastodonBridge: {
      handle: mastodonBridgeHandle,
      email: `noreply+${mastodonBridgeHandle}@${hostname}`,
      displayName: env.mastodonBridgeDisplayName ?? 'Mastodon Bridge',
      description:
        env.mastodonBridgeDescription ??
        'This account posts content from Mastodon and other Fediverse servers.',
    },
    blueskyBridge: {
      handle: blueskyBridgeHandle,
      email: `noreply+${blueskyBridgeHandle}@${hostname}`,
      displayName: env.blueskyBridgeDisplayName ?? 'Bluesky Bridge',
      description:
        env.blueskyBridgeDescription ??
        'This account relays replies from external Bluesky users.',
    },
    constellation: {
      url: env.constellationUrl ?? '',
      pollInterval: env.constellationPollInterval ?? 60000, // Default 60 seconds
    },
    appView: {
      url: env.appViewUrl ?? 'https://public.api.bsky.app',
    },
    allowPrivateAddress: env.allowPrivateAddress ?? false,
  }
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}
