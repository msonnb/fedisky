import crypto from 'node:crypto'
import { AtpAgent, BlobRef } from '@atproto/api'
import { APFederationConfig } from '../config'
import { APDatabase } from '../db'
import { apLogger } from '../logger'
import { PDSClient } from '../pds-client'

/**
 * Manages the Bluesky bridge account used for federating external Bluesky
 * replies to ActivityPub. Unlike the Mastodon bridge account, this account
 * is exposed as an ActivityPub actor.
 */
export class BlueskyBridgeAccountManager {
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
      const existing = await this.db.getBlueskyBridgeAccount()

      if (existing) {
        apLogger.info('found existing bluesky bridge account in database', {
          did: existing.did,
          handle: existing.handle,
        })

        const account = await this.pdsClient.getAccount(existing.did)
        if (!account) {
          apLogger.warn(
            'bluesky bridge account no longer exists on PDS, will recreate',
            { did: existing.did },
          )
          await this.db.deleteBlueskyBridgeAccount()
        } else {
          try {
            await this.refreshSession(existing.refreshJwt)
            this._did = existing.did
            this._handle = existing.handle
            this._available = true
            apLogger.info(
              'bluesky bridge account session refreshed successfully',
              { did: this._did, handle: this._handle },
            )
            return
          } catch (refreshErr) {
            apLogger.warn(
              'failed to refresh bluesky bridge account session, will try to login',
              { err: refreshErr },
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

              await this.db.updateBlueskyBridgeAccountTokens(
                session.accessJwt,
                session.refreshJwt,
              )

              this._available = true
              apLogger.info('bluesky bridge account logged in successfully', {
                did: this._did,
                handle: this._handle,
              })
              return
            } catch (loginErr) {
              apLogger.warn(
                'failed to login to bluesky bridge account, will recreate',
                { err: loginErr },
              )
              await this.db.deleteBlueskyBridgeAccount()
            }
          }
        }
      }

      await this.createBlueskyBridgeAccount()
    } catch (err) {
      apLogger.error(
        'failed to initialize bluesky bridge account - external reply federation will be disabled',
        { err },
      )
      this._available = false
    }
  }

  private async createBlueskyBridgeAccount(): Promise<void> {
    const { handle, email, displayName, description } = this.cfg.blueskyBridge

    apLogger.info('creating new bluesky bridge account', { handle, email })

    const password = crypto.randomBytes(32).toString('hex')

    let inviteCode: string | undefined
    try {
      inviteCode = await this.pdsClient.createInviteCode(1)
      apLogger.debug('created invite code for bluesky bridge account')
    } catch (err) {
      apLogger.debug('could not create invite code (invites may be disabled)', {
        err,
      })
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

      await this.db.saveBlueskyBridgeAccount({
        did: result.did,
        handle: result.handle,
        password,
        accessJwt: result.accessJwt,
        refreshJwt: result.refreshJwt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      apLogger.info('bluesky bridge account created successfully', {
        did: this._did,
        handle: this._handle,
      })

      await this.setupProfile(displayName, description)

      this._available = true
    } catch (err) {
      apLogger.error('failed to create bluesky bridge account', {
        err,
        handle,
        email,
      })
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
        ...(existingProfile || {}),
        $type: 'app.bsky.actor.profile',
        displayName,
        description,
      }

      await agent.com.atproto.repo.putRecord({
        repo: this._did,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
        record: profileRecord,
      })

      apLogger.info('bluesky bridge account profile set up', { did: this._did })
    } catch (err) {
      apLogger.warn('failed to set up bluesky bridge account profile', { err })
    }
  }

  private async refreshSession(refreshJwt: string): Promise<void> {
    const tokens = await this.pdsClient.refreshSession(refreshJwt)
    this._accessJwt = tokens.accessJwt
    this._refreshJwt = tokens.refreshJwt

    await this.db.updateBlueskyBridgeAccountTokens(
      tokens.accessJwt,
      tokens.refreshJwt,
    )
  }

  async getAgent(): Promise<AtpAgent> {
    if (!this._available || !this._accessJwt) {
      throw new Error('Bluesky bridge account is not available')
    }

    return this.pdsClient.createAuthenticatedAgent(this._accessJwt)
  }

  async createRecord(
    collection: string,
    record: Record<string, unknown>,
    rkey?: string,
  ): Promise<{ uri: string; cid: string }> {
    if (!this._available || !this._did) {
      throw new Error('Bluesky bridge account is not available')
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
      throw new Error('Bluesky bridge account is not available')
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
