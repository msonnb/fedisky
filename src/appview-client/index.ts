import { logger } from '../logger'

export interface RecordResult {
  uri: string
  cid: string
  value: { [_ in string]: unknown }
}

export interface ProfileResult {
  displayName?: string
  description?: string
  handle?: string
}

/**
 * Client for fetching public records from the ATProto AppView.
 * Used to fetch records from external Bluesky users (not on the local PDS).
 *
 * Uses raw fetch instead of AtpAgent to avoid lexicon validation issues
 * when fetching from non-standard sources (e.g., Constellation API).
 */
export class AppViewClient {
  private serviceUrl: string

  constructor(serviceUrl: string) {
    this.serviceUrl = serviceUrl.replace(/\/$/, '')
  }

  async getRecord(
    did: string,
    collection: string,
    rkey: string,
  ): Promise<RecordResult | null> {
    const params = new URLSearchParams({
      repo: did,
      collection,
      rkey,
    })
    const url = `${this.serviceUrl}/xrpc/com.atproto.repo.getRecord?${params}`

    try {
      const res = await fetch(url)
      if (res.status === 404 || res.status === 400) {
        const data = (await res.json()) as { error?: string }
        if (
          data.error === 'RecordNotFound' ||
          data.error === 'NotFound' ||
          data.error === 'RepoNotFound'
        ) {
          return null
        }
      }
      if (!res.ok) {
        logger.warn('failed to get record from appview', {
          status: res.status,
          did,
          collection,
          rkey,
        })
        return null
      }
      const data = (await res.json()) as {
        uri: string
        cid?: string
        value: { [_ in string]: unknown }
      }
      return {
        uri: data.uri,
        cid: data.cid ?? '',
        value: data.value,
      }
    } catch (err: unknown) {
      logger.warn('failed to get record from appview', {
        err,
        did,
        collection,
        rkey,
      })
      return null
    }
  }

  async getProfile(did: string): Promise<ProfileResult | null> {
    const record = await this.getRecord(did, 'app.bsky.actor.profile', 'self')
    if (!record) {
      return null
    }
    return record.value as ProfileResult
  }

  async resolveHandle(handle: string): Promise<string | null> {
    const params = new URLSearchParams({ handle })
    const url = `${this.serviceUrl}/xrpc/com.atproto.identity.resolveHandle?${params}`

    try {
      const res = await fetch(url)
      if (res.status === 404 || res.status === 400) {
        return null
      }
      if (!res.ok) {
        logger.warn('failed to resolve handle from appview', {
          status: res.status,
          handle,
        })
        return null
      }
      const data = (await res.json()) as { did: string }
      return data.did
    } catch (err: unknown) {
      logger.warn('failed to resolve handle from appview', { err, handle })
      return null
    }
  }
}
