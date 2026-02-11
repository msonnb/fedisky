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
    mastodonBridgeEnabled: envBool('AP_MASTODON_BRIDGE_ENABLED'),
    mastodonBridgeHandle: envStr('AP_MASTODON_BRIDGE_HANDLE'),
    mastodonBridgeDisplayName: envStr('AP_MASTODON_BRIDGE_DISPLAY_NAME'),
    mastodonBridgeDescription: envStr('AP_MASTODON_BRIDGE_DESCRIPTION'),
    mastodonBridgeAvatarUrl: envStr('AP_MASTODON_BRIDGE_AVATAR_URL'),
    allowPrivateAddress: envBool('AP_ALLOW_PRIVATE_ADDRESS'),
    // Bluesky bridge account config
    blueskyBridgeEnabled: envBool('AP_BLUESKY_BRIDGE_ENABLED'),
    blueskyBridgeHandle: envStr('AP_BLUESKY_BRIDGE_HANDLE'),
    blueskyBridgeDisplayName: envStr('AP_BLUESKY_BRIDGE_DISPLAY_NAME'),
    blueskyBridgeDescription: envStr('AP_BLUESKY_BRIDGE_DESCRIPTION'),
    blueskyBridgeAvatarUrl: envStr('AP_BLUESKY_BRIDGE_AVATAR_URL'),
    // Constellation config
    constellationUrl: envStr('AP_CONSTELLATION_URL'),
    constellationPollInterval: envInt('AP_CONSTELLATION_POLL_INTERVAL'),
    // AppView config
    appViewUrl: envStr('AP_APPVIEW_URL'),
    // DM notifications config
    dmNotificationsEnabled: envBool('AP_DM_NOTIFICATIONS_ENABLED'),
    dmNotificationsPollInterval: envInt('AP_DM_NOTIFICATIONS_POLL_INTERVAL'),
    dmNotificationsBatchDelay: envInt('AP_DM_NOTIFICATIONS_BATCH_DELAY'),
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
    enabled: boolean
    handle: string
    email: string
    displayName: string
    description: string
    avatarUrl?: string
  }
  /** Bluesky bridge account for federating external Bluesky replies */
  blueskyBridge: {
    enabled: boolean
    handle: string
    email: string
    displayName: string
    description: string
    avatarUrl?: string
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
  /** DM notifications for Fediverse engagement */
  dmNotifications: {
    enabled: boolean
    pollInterval: number
    batchDelay: number
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
      enabled: env.mastodonBridgeEnabled ?? true,
      handle: mastodonBridgeHandle,
      email: `noreply+${mastodonBridgeHandle}@${hostname}`,
      displayName: env.mastodonBridgeDisplayName ?? 'Mastodon Bridge',
      description:
        env.mastodonBridgeDescription ??
        'This account posts content from Mastodon and other Fediverse servers.',
      avatarUrl:
        env.mastodonBridgeAvatarUrl ??
        'https://joinmastodon.org/logos/logo-purple.svg',
    },
    blueskyBridge: {
      enabled: env.blueskyBridgeEnabled ?? true,
      handle: blueskyBridgeHandle,
      email: `noreply+${blueskyBridgeHandle}@${hostname}`,
      displayName: env.blueskyBridgeDisplayName ?? 'Bluesky Bridge',
      description:
        env.blueskyBridgeDescription ??
        'This account relays replies from external Bluesky users.',
      avatarUrl:
        env.blueskyBridgeAvatarUrl ??
        'https://upload.wikimedia.org/wikipedia/commons/7/7a/Bluesky_Logo.svg',
    },
    constellation: {
      url: env.constellationUrl ?? '',
      pollInterval: env.constellationPollInterval ?? 60000, // Default 60 seconds
    },
    appView: {
      url: env.appViewUrl ?? 'https://public.api.bsky.app',
    },
    dmNotifications: {
      enabled: env.dmNotificationsEnabled ?? true,
      pollInterval: env.dmNotificationsPollInterval ?? 300000, // 5 minutes
      batchDelay: env.dmNotificationsBatchDelay ?? 600000, // 10 minutes
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
