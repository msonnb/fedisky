import crypto from 'crypto'
import { AtpAgent, BlobRef } from '@atproto/api'
import { APFederationConfig } from '../config'
import { APDatabase } from '../db'
import { PDSClient } from '../pds-client'
import { apLogger } from '../logger'

export class BridgeAccountManager {
  private cfg: APFederationConfig
  private db: APDatabase
  private pdsClient: PDSClient
  private _available: boolean = false
  private _did: string | null = null
  private _handle: string | null = null
  private _accessJwt: string | null = null
  private _refreshJwt: string | null = null

  constructor(cfg: APFederationConfig, db: APDatabase, pdsClient: PDSClient) {
    this.cfg = cfg
    this.db = db
    this.pdsClient = pdsClient
  }

  isAvailable(): boolean {
    return this._available
  }

  get did(): string | null {
    return this._did
  }

  get handle(): string | null {
    return this._handle
  }

  async initialize(): Promise<void> {
    try {
      const existing = await this.db.getBridgeAccount()

      if (existing) {
        apLogger.info(
          { did: existing.did, handle: existing.handle },
          'found existing bridge account in database',
        )

        const account = await this.pdsClient.getAccount(existing.did)
        if (!account) {
          apLogger.warn(
            { did: existing.did },
            'bridge account no longer exists on PDS, will recreate',
          )
          await this.db.deleteBridgeAccount()
        } else {
          try {
            await this.refreshSession(existing.refreshJwt)
            this._did = existing.did
            this._handle = existing.handle
            this._available = true
            apLogger.info(
              { did: this._did, handle: this._handle },
              'bridge account session refreshed successfully',
            )
            return
          } catch (refreshErr) {
            apLogger.warn(
              { err: refreshErr },
              'failed to refresh bridge account session, will try to login',
            )

            try {
              const session = await this.pdsClient.createSession(
                existing.handle,
                existing.password,
              )
              this._accessJwt = session.accessJwt
              this._refreshJwt = session.refreshJwt
              this._did = session.did
              this._handle = session.handle

              await this.db.updateBridgeAccountTokens(
                session.accessJwt,
                session.refreshJwt,
              )

              this._available = true
              apLogger.info(
                { did: this._did, handle: this._handle },
                'bridge account logged in successfully',
              )
              return
            } catch (loginErr) {
              apLogger.warn(
                { err: loginErr },
                'failed to login to bridge account, will recreate',
              )
              await this.db.deleteBridgeAccount()
            }
          }
        }
      }

      await this.createBridgeAccount()
    } catch (err) {
      apLogger.error(
        { err },
        'failed to initialize bridge account - incoming replies will be disabled',
      )
      this._available = false
    }
  }

  private async createBridgeAccount(): Promise<void> {
    const { handle, email, displayName, description } = this.cfg.bridge

    apLogger.info({ handle, email }, 'creating new bridge account')

    const password = crypto.randomBytes(32).toString('hex')

    let inviteCode: string | undefined
    try {
      inviteCode = await this.pdsClient.createInviteCode(1)
      apLogger.debug('created invite code for bridge account')
    } catch (err) {
      apLogger.debug(
        { err },
        'could not create invite code (invites may be disabled)',
      )
    }

    try {
      const result = await this.pdsClient.createAccount(
        handle,
        email,
        password,
        inviteCode,
      )

      this._did = result.did
      this._handle = result.handle
      this._accessJwt = result.accessJwt
      this._refreshJwt = result.refreshJwt

      await this.db.saveBridgeAccount({
        did: result.did,
        handle: result.handle,
        password,
        accessJwt: result.accessJwt,
        refreshJwt: result.refreshJwt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      apLogger.info(
        { did: this._did, handle: this._handle },
        'bridge account created successfully',
      )

      await this.setupProfile(displayName, description)

      this._available = true
    } catch (err) {
      apLogger.error({ err, handle, email }, 'failed to create bridge account')
      throw err
    }
  }

  private async setupProfile(
    displayName: string,
    description: string,
  ): Promise<void> {
    if (!this._accessJwt || !this._did) {
      apLogger.warn('cannot setup profile: no access token or DID')
      return
    }

    try {
      const agent = this.pdsClient.createAuthenticatedAgent(this._accessJwt)

      let existingProfile: Record<string, unknown> | null = null
      try {
        const res = await agent.com.atproto.repo.getRecord({
          repo: this._did,
          collection: 'app.bsky.actor.profile',
          rkey: 'self',
        })
        existingProfile = res.data.value as Record<string, unknown>
      } catch {
        // Profile doesn't exist yet, that's fine
      }

      const profileRecord = {
        $type: 'app.bsky.actor.profile',
        displayName,
        description,
        ...(existingProfile || {}),
      }

      await agent.com.atproto.repo.putRecord({
        repo: this._did,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
        record: profileRecord,
      })

      apLogger.info({ did: this._did }, 'bridge account profile set up')
    } catch (err) {
      apLogger.warn({ err }, 'failed to set up bridge account profile')
    }
  }

  private async refreshSession(refreshJwt: string): Promise<void> {
    const tokens = await this.pdsClient.refreshSession(refreshJwt)
    this._accessJwt = tokens.accessJwt
    this._refreshJwt = tokens.refreshJwt

    await this.db.updateBridgeAccountTokens(tokens.accessJwt, tokens.refreshJwt)
  }

  async getAgent(): Promise<AtpAgent> {
    if (!this._available || !this._accessJwt) {
      throw new Error('Bridge account is not available')
    }

    return this.pdsClient.createAuthenticatedAgent(this._accessJwt)
  }

  async createRecord(
    collection: string,
    record: Record<string, unknown>,
    rkey?: string,
  ): Promise<{ uri: string; cid: string }> {
    if (!this._available || !this._did) {
      throw new Error('Bridge account is not available')
    }

    const agent = await this.getAgent()

    try {
      const res = await agent.com.atproto.repo.createRecord({
        repo: this._did,
        collection,
        rkey,
        record,
      })

      return {
        uri: res.data.uri,
        cid: res.data.cid,
      }
    } catch (err: unknown) {
      // If we get an auth error, try to refresh and retry
      const error = err as { status?: number; error?: string }
      if (
        error.status === 400 &&
        (error.error === 'ExpiredToken' || error.error === 'InvalidToken')
      ) {
        if (this._refreshJwt) {
          await this.refreshSession(this._refreshJwt)
          const retryAgent = await this.getAgent()
          const res = await retryAgent.com.atproto.repo.createRecord({
            repo: this._did,
            collection,
            rkey,
            record,
          })
          return {
            uri: res.data.uri,
            cid: res.data.cid,
          }
        }
      }
      throw err
    }
  }

  async uploadBlob(data: Uint8Array, mimeType: string): Promise<BlobRef> {
    if (!this._available) {
      throw new Error('Bridge account is not available')
    }

    const agent = await this.getAgent()

    try {
      const res = await agent.com.atproto.repo.uploadBlob(data, {
        encoding: mimeType,
      })
      return res.data.blob
    } catch (err: unknown) {
      // If we get an auth error, try to refresh and retry
      const error = err as { status?: number; error?: string }
      if (
        error.status === 400 &&
        (error.error === 'ExpiredToken' || error.error === 'InvalidToken')
      ) {
        if (this._refreshJwt) {
          await this.refreshSession(this._refreshJwt)
          const retryAgent = await this.getAgent()
          const res = await retryAgent.com.atproto.repo.uploadBlob(data, {
            encoding: mimeType,
          })
          return res.data.blob
        }
      }
      throw err
    }
  }
}
