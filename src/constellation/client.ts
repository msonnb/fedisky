import { apLogger } from '../logger'

export interface BacklinkRecord {
  uri: string
  cid: string
}

export interface GetBacklinksResponse {
  backlinks: BacklinkRecord[]
  cursor?: string
}

/**
 * Client for the Constellation API (https://constellation.microcosm.blue)
 * Used to discover backlinks to ATProto records, such as replies to posts.
 */
export class ConstellationClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    // Remove trailing slash if present
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  /**
   * Get backlinks to a subject (AT URI or DID) from records of a specific collection.
   *
   * @param subject - The AT URI or DID to find backlinks to
   * @param source - The source collection and path, e.g., "app.bsky.feed.post:reply.parent.uri"
   * @param options - Additional query options
   * @returns Array of backlink records
   */
  async getBacklinks(
    subject: string,
    source: string,
    options?: {
      limit?: number
      reverse?: boolean
      cursor?: string
    },
  ): Promise<GetBacklinksResponse> {
    const params = new URLSearchParams()
    params.set('subject', subject)
    params.set('source', source)

    if (options?.limit) {
      params.set('limit', String(options.limit))
    }
    if (options?.reverse) {
      params.set('reverse', 'true')
    }
    if (options?.cursor) {
      params.set('cursor', options.cursor)
    }

    const url = `${this.baseUrl}/xrpc/blue.microcosm.links.getBacklinks?${params}`

    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'fedisky/1.0 (ActivityPub bridge for ATProto)',
        },
      })

      if (!res.ok) {
        const text = await res.text()
        apLogger.warn('constellation API error', {
          status: res.status,
          body: text,
          url,
        })
        throw new Error(`Constellation API error: ${res.status} ${text}`)
      }

      const data = (await res.json()) as {
        backlinks?: Array<{ uri: string; cid: string }>
        cursor?: string
      }

      return {
        backlinks:
          data.backlinks?.map((b) => ({
            uri: b.uri,
            cid: b.cid,
          })) ?? [],
        cursor: data.cursor,
      }
    } catch (err) {
      apLogger.warn('failed to fetch backlinks', { err, subject, source })
      throw err
    }
  }

  /**
   * Get all replies to a post.
   * Convenience method that wraps getBacklinks with the correct source.
   */
  async getReplies(
    postAtUri: string,
    options?: {
      limit?: number
      cursor?: string
    },
  ): Promise<GetBacklinksResponse> {
    return this.getBacklinks(
      postAtUri,
      'app.bsky.feed.post:reply.parent.uri',
      options,
    )
  }
}
