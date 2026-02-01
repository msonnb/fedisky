import { SqliteKvStore } from '@fedify/sqlite'
import { createFederation, type Federation } from '@fedify/fedify'
import { DatabaseSync } from 'node:sqlite'
import { BridgeAccountManager } from './bridge-account'
import { APFederationConfig } from './config'
import { APDatabase } from './db'
import { logger } from './logger'
import { PDSClient } from './pds-client'

export type AppContextOptions = {
  cfg: APFederationConfig
  db: APDatabase
  pdsClient: PDSClient
  bridgeAccount: BridgeAccountManager
  federation: Federation<void>
  logger: typeof logger
}

export class AppContext {
  public cfg: APFederationConfig
  public db: APDatabase
  public pdsClient: PDSClient
  public bridgeAccount: BridgeAccountManager
  public federation: Federation<void>
  public logger: typeof logger

  constructor(opts: AppContextOptions) {
    this.cfg = opts.cfg
    this.db = opts.db
    this.pdsClient = opts.pdsClient
    this.bridgeAccount = opts.bridgeAccount
    this.federation = opts.federation
    this.logger = opts.logger
  }

  static fromConfig(cfg: APFederationConfig): AppContext {
    const db = new APDatabase(cfg.db.location)
    const pdsClient = new PDSClient(cfg)
    const bridgeAccount = new BridgeAccountManager(cfg, db, pdsClient)
    const kvDbPath = cfg.db.location.replace(/\.sqlite$/, '-kv.sqlite')
    const kvDb = new DatabaseSync(kvDbPath)
    const federation = createFederation<void>({
      kv: new SqliteKvStore(kvDb),
      allowPrivateAddress: cfg.allowPrivateAddress,
    })
    return new AppContext({
      cfg,
      db,
      pdsClient,
      bridgeAccount,
      federation,
      logger,
    })
  }
}
