import { DatabaseSync } from 'node:sqlite'
import { createFederation, type Federation } from '@fedify/fedify'
import { SqliteKvStore, SqliteMessageQueue } from '@fedify/sqlite'
import { AppViewClient } from './appview-client'
import { BlueskyBridgeAccountManager } from './bluesky-bridge'
import { APFederationConfig } from './config'
import { APDatabase } from './db'
import { logger } from './logger'
import { MastodonBridgeAccountManager } from './mastodon-bridge'
import { PDSClient } from './pds-client'

export type AppContextOptions = {
  cfg: APFederationConfig
  db: APDatabase
  pdsClient: PDSClient
  mastodonBridgeAccount: MastodonBridgeAccountManager
  blueskyBridgeAccount: BlueskyBridgeAccountManager
  appViewClient: AppViewClient
  federation: Federation<void>
  logger: typeof logger
}

export class AppContext {
  public cfg: APFederationConfig
  public db: APDatabase
  public pdsClient: PDSClient
  public mastodonBridgeAccount: MastodonBridgeAccountManager
  public blueskyBridgeAccount: BlueskyBridgeAccountManager
  public appViewClient: AppViewClient
  public federation: Federation<void>
  public logger: typeof logger

  constructor(opts: AppContextOptions) {
    this.cfg = opts.cfg
    this.db = opts.db
    this.pdsClient = opts.pdsClient
    this.mastodonBridgeAccount = opts.mastodonBridgeAccount
    this.blueskyBridgeAccount = opts.blueskyBridgeAccount
    this.appViewClient = opts.appViewClient
    this.federation = opts.federation
    this.logger = opts.logger
  }

  static fromConfig(cfg: APFederationConfig): AppContext {
    const db = new APDatabase(cfg.db.location)
    const pdsClient = new PDSClient(cfg)
    const mastodonBridgeAccount = new MastodonBridgeAccountManager(
      cfg,
      db,
      pdsClient,
    )
    const blueskyBridgeAccount = new BlueskyBridgeAccountManager(
      cfg,
      db,
      pdsClient,
    )
    const appViewClient = new AppViewClient(cfg.appView.url)
    const kvDbPath = cfg.db.location.replace(/\.sqlite$/, '-kv.sqlite')
    const kvDb = new DatabaseSync(kvDbPath)
    const federation = createFederation<void>({
      kv: new SqliteKvStore(kvDb),
      queue: new SqliteMessageQueue(kvDb),
      allowPrivateAddress: cfg.allowPrivateAddress,
    })
    return new AppContext({
      cfg,
      db,
      pdsClient,
      mastodonBridgeAccount,
      blueskyBridgeAccount,
      appViewClient,
      federation,
      logger,
    })
  }
}
