import crypto from 'node:crypto'
import { AtpAgent, BlobRef } from '@atproto/api'
import { APFederationConfig } from '../config'
import { APDatabase } from '../db'
import { logger } from '../logger'
import { PDSClient } from '../pds-client'
import { AccountDatabaseOps, BridgeAccountConfig } from './types'

export abstract class BaseAccountManager {
  protected cfg: APFederationConfig
  protected db: APDatabase
  protected pdsClient: PDSClient
  private _available: boolean = false
  private _did: string | null = null
  private _handle: string | null = null
  private _accessJwt: string | null = null
  private _refreshJwt: string | null = null

  protected abstract readonly accountName: string
  protected abstract readonly disabledFeatureMsg: string
  protected abstract getAccountConfig(): BridgeAccountConfig
  protected abstract getDbOps(): AccountDatabaseOps

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
    const dbOps = this.getDbOps()

    try {
      const existing = await dbOps.get()

      if (existing) {
        logger.info(`found existing ${this.accountName} account in database`, {
          did: existing.did,
          handle: existing.handle,
        })

        const account = await this.pdsClient.getAccount(existing.did)
        if (!account) {
          logger.warn(
            `${this.accountName} account no longer exists on PDS, will recreate`,
            { did: existing.did },
          )
          await dbOps.delete()
        } else {
          try {
            await this.refreshSession(existing.refreshJwt)
            this._did = existing.did
            this._handle = existing.handle
            this._available = true
            logger.info(
              `${this.accountName} account session refreshed successfully`,
              { did: this._did, handle: this._handle },
            )
            return
          } catch (refreshErr) {
            logger.warn(
              `failed to refresh ${this.accountName} account session, will try to login`,
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

              await dbOps.updateTokens(session.accessJwt, session.refreshJwt)

              this._available = true
              logger.info(
                `${this.accountName} account logged in successfully`,
                {
                  did: this._did,
                  handle: this._handle,
                },
              )
              return
            } catch (loginErr) {
              logger.warn(
                `failed to login to ${this.accountName} account, will recreate`,
                { err: loginErr },
              )
              await dbOps.delete()
            }
          }
        }
      }

      await this.createAccount()
    } catch (err) {
      logger.error(
        `failed to initialize ${this.accountName} account - ${this.disabledFeatureMsg}`,
        { err },
      )
      this._available = false
    }
  }

  private async createAccount(): Promise<void> {
    const dbOps = this.getDbOps()
    const { handle, email, displayName, description, avatarUrl } =
      this.getAccountConfig()

    logger.info(`creating new ${this.accountName} account`, { handle, email })

    const password = crypto.randomBytes(32).toString('hex')

    let inviteCode: string | undefined
    try {
      inviteCode = await this.pdsClient.createInviteCode(1)
      logger.debug(`created invite code for ${this.accountName} account`)
    } catch (err) {
      logger.debug('could not create invite code (invites may be disabled)', {
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

      await dbOps.save({
        did: result.did,
        handle: result.handle,
        password,
        accessJwt: result.accessJwt,
        refreshJwt: result.refreshJwt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      logger.info(`${this.accountName} account created successfully`, {
        did: this._did,
        handle: this._handle,
      })

      await this.setupProfile(displayName, description, avatarUrl)

      this._available = true
    } catch (err) {
      logger.error(`failed to create ${this.accountName} account`, {
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
    avatarUrl?: string,
  ): Promise<void> {
    if (!this._accessJwt || !this._did) {
      logger.warn('cannot setup profile: no access token or DID')
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

      let avatar: BlobRef | undefined
      if (avatarUrl) {
        try {
          const response = await fetch(avatarUrl)
          if (response.ok) {
            const contentType =
              response.headers.get('content-type') || 'image/svg+xml'
            const data = new Uint8Array(await response.arrayBuffer())
            const res = await agent.com.atproto.repo.uploadBlob(data, {
              encoding: contentType,
            })
            avatar = res.data.blob
            logger.info(`uploaded avatar for ${this.accountName} account`, {
              avatarUrl,
              contentType,
            })
          } else {
            logger.warn(`failed to fetch avatar for ${this.accountName}`, {
              avatarUrl,
              status: response.status,
            })
          }
        } catch (err) {
          logger.warn(`failed to upload avatar for ${this.accountName}`, {
            avatarUrl,
            err,
          })
        }
      }

      const profileRecord = {
        ...(existingProfile || {}),
        $type: 'app.bsky.actor.profile',
        displayName,
        description,
        ...(avatar ? { avatar } : {}),
      }

      await agent.com.atproto.repo.putRecord({
        repo: this._did,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
        record: profileRecord,
      })

      logger.info(`${this.accountName} account profile set up`, {
        did: this._did,
      })
    } catch (err) {
      logger.warn(`failed to set up ${this.accountName} account profile`, {
        err,
      })
    }
  }

  private async refreshSession(refreshJwt: string): Promise<void> {
    const dbOps = this.getDbOps()
    const tokens = await this.pdsClient.refreshSession(refreshJwt)
    this._accessJwt = tokens.accessJwt
    this._refreshJwt = tokens.refreshJwt

    await dbOps.updateTokens(tokens.accessJwt, tokens.refreshJwt)
  }

  async getAgent(): Promise<AtpAgent> {
    if (!this._available || !this._accessJwt) {
      throw new Error(`${this.accountName} account is not available`)
    }

    return this.pdsClient.createAuthenticatedAgent(this._accessJwt)
  }

  private async withAuthRetry<T>(
    fn: (agent: AtpAgent) => Promise<T>,
  ): Promise<T> {
    if (!this._available) {
      throw new Error(`${this.accountName} account is not available`)
    }

    const agent = await this.getAgent()

    try {
      return await fn(agent)
    } catch (err: unknown) {
      const error = err as { status?: number; error?: string }
      if (
        error.status === 400 &&
        (error.error === 'ExpiredToken' || error.error === 'InvalidToken') &&
        this._refreshJwt
      ) {
        await this.refreshSession(this._refreshJwt)
        const retryAgent = await this.getAgent()
        return await fn(retryAgent)
      }
      throw err
    }
  }

  async createRecord(
    collection: string,
    record: Record<string, unknown>,
    rkey?: string,
  ): Promise<{ uri: string; cid: string }> {
    if (!this._did) {
      throw new Error(`${this.accountName} account is not available`)
    }
    const did = this._did

    return this.withAuthRetry(async (agent) => {
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection,
        rkey,
        record,
      })
      return { uri: res.data.uri, cid: res.data.cid }
    })
  }

  async deleteRecord(collection: string, rkey: string): Promise<void> {
    if (!this._did) {
      throw new Error(`${this.accountName} account is not available`)
    }
    const did = this._did

    await this.withAuthRetry(async (agent) => {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection,
        rkey,
      })
    })
  }

  async uploadBlob(data: Uint8Array, mimeType: string): Promise<BlobRef> {
    return this.withAuthRetry(async (agent) => {
      const res = await agent.com.atproto.repo.uploadBlob(data, {
        encoding: mimeType,
      })
      return res.data.blob
    })
  }
}
