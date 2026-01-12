import { envBool, envInt, envStr } from '@atproto/common'

export function readEnv() {
  return {
    port: envInt('AP_PORT'),
    hostname: envStr('AP_HOSTNAME'),
    version: envStr('AP_VERSION'),
    pdsUrl: envStr('PDS_URL'),
    pdsAdminToken: envStr('PDS_ADMIN_TOKEN'),
    dbLocation: envStr('AP_DB_LOCATION'),
    firehoseEnabled: envBool('AP_FIREHOSE_ENABLED'),
    firehoseCursor: envStr('AP_FIREHOSE_CURSOR'),
    bridgeHandle: envStr('AP_BRIDGE_HANDLE'),
    bridgeDisplayName: envStr('AP_BRIDGE_DISPLAY_NAME'),
    bridgeDescription: envStr('AP_BRIDGE_DESCRIPTION'),
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
  }
  db: {
    location: string
  }
  firehose: {
    enabled: boolean
    cursor?: number
  }
  bridge: {
    handle: string
    email: string
    displayName: string
    description: string
  }
}

export function envToConfig(env: ServerEnvironment): APFederationConfig {
  const port = env.port ?? 2588
  const hostname = env.hostname ?? 'localhost'
  const publicUrl =
    hostname === 'localhost'
      ? `http://localhost:${port}`
      : `https://${hostname}`
  const version = env.version ?? '0.0.0'
  const bridgeHandle =
    env.bridgeHandle ??
    `mastodon.${hostname === 'localhost' ? 'test' : hostname}`
  return {
    service: {
      port,
      publicUrl,
      hostname,
      version,
    },
    pds: {
      url: requireEnv('PDS_URL', env.pdsUrl),
      adminToken: requireEnv('PDS_ADMIN_TOKEN', env.pdsAdminToken),
    },
    db: {
      location: env.dbLocation ?? ':memory:',
    },
    firehose: {
      enabled: env.firehoseEnabled ?? true,
      cursor: env.firehoseCursor ? parseInt(env.firehoseCursor, 10) : undefined,
    },
    bridge: {
      handle: bridgeHandle,
      email: `noreply+${bridgeHandle}@${hostname}`,
      displayName: env.bridgeDisplayName ?? 'Mastodon Bridge',
      description:
        env.bridgeDescription ??
        'This account posts content from Mastodon and other Fediverse servers.',
    },
  }
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}
