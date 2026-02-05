import {
  AccountDatabaseOps,
  BaseAccountManager,
  BridgeAccountConfig,
} from '../account-manager'

/**
 * Manages the Mastodon bridge account used for posting incoming Fediverse
 * replies back to Bluesky. This account is hidden from ActivityPub federation.
 */
export class MastodonBridgeAccountManager extends BaseAccountManager {
  protected readonly accountName = 'mastodon bridge'
  protected readonly disabledFeatureMsg =
    'incoming fediverse replies will be disabled'

  protected getAccountConfig(): BridgeAccountConfig {
    return this.cfg.mastodonBridge
  }

  protected getDbOps(): AccountDatabaseOps {
    return {
      get: () => this.db.getMastodonBridgeAccount(),
      save: (data) => this.db.saveMastodonBridgeAccount(data),
      updateTokens: (accessJwt, refreshJwt) =>
        this.db.updateMastodonBridgeAccountTokens(accessJwt, refreshJwt),
      delete: () => this.db.deleteMastodonBridgeAccount(),
    }
  }
}
