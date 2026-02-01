import { AtpAgent } from '@atproto/api'
import { AccountView } from '@atproto/api/dist/client/types/com/atproto/admin/defs'
import { Main as ProfileRecord } from '@atproto/bsky/dist/lexicon/types/app/bsky/actor/profile'
import { APFederationConfig } from '../config'
import { apLogger } from '../logger'

export interface RecordResult {
  uri: string
  cid: string
  value: { [_ in string]: unknown }
}

export interface ListRecordsOpts {
  limit?: number
  cursor?: string
  reverse?: boolean
}

export interface CreateAccountResult {
  did: string
  handle: string
  accessJwt: string
  refreshJwt: string
}

export interface SessionTokens {
  accessJwt: string
  refreshJwt: string
}

export class PDSClient {
  private agent: AtpAgent
  private cfg: APFederationConfig

  constructor(cfg: APFederationConfig) {
    this.cfg = cfg
    this.agent = new AtpAgent({ service: cfg.pds.url })

    // Set admin auth header using Basic auth
    const credentials = Buffer.from(`admin:${cfg.pds.adminToken}`).toString(
      'base64',
    )
    this.agent.setHeader('authorization', `Basic ${credentials}`)
  }

  async createInviteCode(useCount: number = 1): Promise<string> {
    const res = await this.agent.com.atproto.server.createInviteCode({
      useCount,
    })
    return res.data.code
  }

  async createAccount(
    handle: string,
    email: string,
    password: string,
    inviteCode?: string,
  ): Promise<CreateAccountResult> {
    // Use a fresh agent without admin auth for account creation
    const createAgent = new AtpAgent({ service: this.cfg.pds.url })

    const res = await createAgent.com.atproto.server.createAccount({
      handle,
      email,
      password,
      inviteCode,
    })

    return {
      did: res.data.did,
      handle: res.data.handle,
      accessJwt: res.data.accessJwt,
      refreshJwt: res.data.refreshJwt,
    }
  }

  async createSession(
    identifier: string,
    password: string,
  ): Promise<SessionTokens & { did: string; handle: string }> {
    const loginAgent = new AtpAgent({ service: this.cfg.pds.url })

    const res = await loginAgent.com.atproto.server.createSession({
      identifier,
      password,
    })

    return {
      did: res.data.did,
      handle: res.data.handle,
      accessJwt: res.data.accessJwt,
      refreshJwt: res.data.refreshJwt,
    }
  }

  async refreshSession(refreshJwt: string): Promise<SessionTokens> {
    const refreshAgent = new AtpAgent({ service: this.cfg.pds.url })
    refreshAgent.setHeader('authorization', `Bearer ${refreshJwt}`)

    const res = await refreshAgent.com.atproto.server.refreshSession()

    return {
      accessJwt: res.data.accessJwt,
      refreshJwt: res.data.refreshJwt,
    }
  }

  createAuthenticatedAgent(accessJwt: string): AtpAgent {
    const userAgent = new AtpAgent({ service: this.cfg.pds.url })
    userAgent.setHeader('authorization', `Bearer ${accessJwt}`)
    return userAgent
  }

  async resolveHandle(handle: string): Promise<string | null> {
    try {
      const res = await this.agent.resolveHandle({
        handle,
      })
      return res.data.did
    } catch (err: unknown) {
      if (isNotFoundError(err)) {
        return null
      }
      apLogger.warn('failed to resolve handle: {handle} {err}', { err, handle })
      return null
    }
  }

  async getAccount(did: string): Promise<AccountView | null> {
    try {
      const res = await this.agent.com.atproto.admin.getAccountInfo({
        did,
      })
      return res.data
    } catch (err: unknown) {
      if (isNotFoundError(err)) {
        return null
      }
      apLogger.warn('failed to get account: {did} {err}', { err, did })
      throw err
    }
  }

  async getAccounts(dids: string[]): Promise<Map<string, AccountView>> {
    const result = new Map<string, AccountView>()

    for (const did of dids) {
      try {
        const account = await this.getAccount(did)
        if (account) {
          result.set(did, account)
        }
      } catch {
        // Skip failed lookups
      }
    }

    return result
  }

  async getAccountCount(): Promise<number> {
    try {
      let cursor: string | undefined = undefined
      let activeRepoCount = 0
      do {
        const res = await this.agent.com.atproto.sync.listRepos({
          limit: 1000,
          cursor,
        })
        activeRepoCount += res.data.repos.filter((repo) => repo.active).length
        if (res.data.repos.length < 1000) {
          break
        }
        cursor = res.data.cursor
      } while (cursor)
      return activeRepoCount
    } catch (err) {
      apLogger.warn('failed to get account count: {err}', { err })
      return 0
    }
  }

  async getProfile(did: string): Promise<ProfileRecord | null> {
    try {
      const res = await this.agent.com.atproto.repo.getRecord({
        repo: did,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
      })
      return res.data.value as ProfileRecord
    } catch (err: unknown) {
      if (isNotFoundError(err)) {
        return null
      }
      apLogger.warn('failed to get profile: {did} {err}', { err, did })
      return null
    }
  }

  async createRecord(
    did: string,
    collection: string,
    record: { [_ in string]: unknown },
    rkey?: string,
  ): Promise<RecordResult> {
    const res = await this.agent.com.atproto.repo.createRecord({
      repo: did,
      collection,
      rkey,
      record,
    })
    return {
      uri: res.data.uri,
      cid: res.data.cid,
      value: record,
    }
  }

  async getRecord(
    did: string,
    collection: string,
    rkey: string,
  ): Promise<RecordResult | null> {
    try {
      const res = await this.agent.com.atproto.repo.getRecord({
        repo: did,
        collection,
        rkey,
      })
      return {
        uri: res.data.uri,
        cid: res.data.cid ?? '',
        value: res.data.value,
      }
    } catch (err: unknown) {
      if (isNotFoundError(err)) {
        return null
      }
      throw err
    }
  }

  async listRecords(
    did: string,
    collection: string,
    opts?: ListRecordsOpts,
  ): Promise<{ records: RecordResult[]; cursor?: string }> {
    const res = await this.agent.com.atproto.repo.listRecords({
      repo: did,
      collection,
      limit: opts?.limit,
      cursor: opts?.cursor,
      reverse: opts?.reverse,
    })
    return {
      records: res.data.records.map((r) => ({
        uri: r.uri,
        cid: r.cid,
        value: r.value,
      })),
      cursor: res.data.cursor,
    }
  }

  getBlobUrl(did: string, cid: string): string {
    return `${this.cfg.service.publicUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`
  }

  getImageUrl(
    did: string,
    cid: string,
    _format: 'avatar' | 'banner' | 'feed_fullsize' | 'feed_thumbnail',
  ): string {
    // Use the blob URL directly for now
    // In production, this could point to an image processing service
    return this.getBlobUrl(did, cid)
  }
}

function isNotFoundError(err: unknown): boolean {
  const error = err as { status?: number; error?: string }
  return error.status === 404 || error.error === 'NotFound'
}
