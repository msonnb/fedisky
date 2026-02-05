import {
  AccountDatabaseOps,
  BaseAccountManager,
  BridgeAccountConfig,
} from '../account-manager'

/**
 * Manages the Bluesky bridge account used for federating external Bluesky
 * replies to ActivityPub. Unlike the Mastodon bridge account, this account
 * is exposed as an ActivityPub actor.
 */
export class BlueskyBridgeAccountManager extends BaseAccountManager {
  protected readonly accountName = 'bluesky bridge'
  protected readonly disabledFeatureMsg =
    'external bluesky reply federation will be disabled'

  protected getAccountConfig(): BridgeAccountConfig {
    return this.cfg.blueskyBridge
  }

  protected getDbOps(): AccountDatabaseOps {
    return {
      get: () => this.db.getBlueskyBridgeAccount(),
      save: (data) => this.db.saveBlueskyBridgeAccount(data),
      updateTokens: (accessJwt, refreshJwt) =>
        this.db.updateBlueskyBridgeAccountTokens(accessJwt, refreshJwt),
      delete: () => this.db.deleteBlueskyBridgeAccount(),
    }
  }
}
