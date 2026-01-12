import {
  createFederation,
  type Federation,
  MemoryKvStore,
} from '@fedify/fedify'
import { APFederationConfig } from './config'
import { APDatabase } from './db'
import { PDSClient } from './pds-client'
import { BridgeAccountManager } from './bridge-account'
import { logger } from './logger'

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
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
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
