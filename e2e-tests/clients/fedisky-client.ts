import { httpRequest, type HttpResponse } from './http-client'

/**
 * Fedisky/ActivityPub Test Client for E2E tests
 *
 * Provides methods to interact with Fedisky's ActivityPub endpoints.
 */

export interface WebFingerLink {
  rel: string
  type?: string
  href?: string
}

export interface WebFingerResponse {
  subject: string
  aliases?: string[]
  links: WebFingerLink[]
}

export interface APActor {
  '@context': unknown
  id: string
  type: string
  preferredUsername: string
  name?: string
  summary?: string
  inbox: string
  outbox: string
  followers?: string
  following?: string
  publicKey?: {
    id: string
    owner: string
    publicKeyPem: string
  }
  icon?: {
    type: string
    url: string
  }
}

export class FediskyClient {
  private baseUrl: string
  private host: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    this.host = new URL(baseUrl).hostname
  }

  private async fetch(
    path: string,
    options: {
      method?: string
      headers?: Record<string, string>
      body?: string
    } = {},
  ): Promise<HttpResponse> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = { ...options.headers }
    return httpRequest(url, this.host, { ...options, headers })
  }

  /**
   * Wait for Fedisky health endpoint to respond
   */
  async waitForHealth(timeoutMs: number = 60000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await this.fetch('/health')
        if (res.ok) return
      } catch {
        // Service not ready yet
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error(`Fedisky health check timed out after ${timeoutMs}ms`)
  }

  /**
   * Perform a WebFinger lookup
   */
  async webfinger(acct: string): Promise<WebFingerResponse | null> {
    // Ensure acct has the right format
    const resource = acct.startsWith('acct:') ? acct : `acct:${acct}`

    const res = await this.fetch(
      `/.well-known/webfinger?resource=${encodeURIComponent(resource)}`,
      {
        headers: {
          Accept: 'application/jrd+json, application/json',
        },
      },
    )
    if (!res.ok) {
      if (res.status === 404) return null
      const text = await res.text()
      throw new Error(`WebFinger lookup failed: ${res.status} ${text}`)
    }
    return res.json() as Promise<WebFingerResponse>
  }

  /**
   * Get an ActivityPub actor by their ID (usually a DID-based path)
   */
  async getActor(actorPath: string): Promise<APActor | null> {
    // actorPath should be like /users/did:plc:xxx or just the path portion
    const path = actorPath.startsWith('/') ? actorPath : `/users/${actorPath}`

    const res = await this.fetch(path, {
      headers: {
        Accept: 'application/activity+json, application/ld+json',
      },
    })
    if (!res.ok) {
      if (res.status === 404) return null
      const text = await res.text()
      throw new Error(`Get actor failed: ${res.status} ${text}`)
    }
    return res.json() as Promise<APActor>
  }

  /**
   * Get an actor's followers collection
   */
  async getFollowers(actorPath: string): Promise<string[]> {
    const path = actorPath.startsWith('/')
      ? `${actorPath}/followers`
      : `/users/${actorPath}/followers`

    const res = await this.fetch(path, {
      headers: {
        Accept: 'application/activity+json, application/ld+json',
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Get followers failed: ${res.status} ${text}`)
    }

    const data = (await res.json()) as {
      type: string
      totalItems?: number
      orderedItems?: string[]
      items?: string[]
      first?: string
    }

    // If items are directly available, return them
    if (data.orderedItems || data.items) {
      return data.orderedItems ?? data.items ?? []
    }

    // If collection is paginated, follow the first page link
    if (data.first) {
      const firstPageUrl = new URL(data.first)
      const firstPageRes = await this.fetch(
        firstPageUrl.pathname + firstPageUrl.search,
        {
          headers: {
            Accept: 'application/activity+json, application/ld+json',
          },
        },
      )
      if (!firstPageRes.ok) {
        const text = await firstPageRes.text()
        throw new Error(
          `Get followers first page failed: ${res.status} ${text}`,
        )
      }
      const firstPageData = (await firstPageRes.json()) as {
        orderedItems?: string[]
        items?: string[]
      }
      return firstPageData.orderedItems ?? firstPageData.items ?? []
    }

    return []
  }

  /**
   * Get an actor's outbox (list of activities)
   */
  async getOutbox(actorPath: string): Promise<unknown[]> {
    const path = actorPath.startsWith('/')
      ? `${actorPath}/outbox`
      : `/users/${actorPath}/outbox`

    const res = await this.fetch(path, {
      headers: {
        Accept: 'application/activity+json, application/ld+json',
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Get outbox failed: ${res.status} ${text}`)
    }

    const data = (await res.json()) as {
      orderedItems?: unknown[]
      items?: unknown[]
      first?: string
    }

    // If items are directly available, return them
    if (data.orderedItems || data.items) {
      return data.orderedItems ?? data.items ?? []
    }

    // If collection is paginated, follow the first page link
    if (data.first) {
      const firstPageUrl = new URL(data.first)
      const firstPageRes = await this.fetch(
        firstPageUrl.pathname + firstPageUrl.search,
        {
          headers: {
            Accept: 'application/activity+json, application/ld+json',
          },
        },
      )
      if (!firstPageRes.ok) {
        const text = await firstPageRes.text()
        throw new Error(`Get outbox first page failed: ${res.status} ${text}`)
      }
      const firstPageData = (await firstPageRes.json()) as {
        orderedItems?: unknown[]
        items?: unknown[]
      }
      return firstPageData.orderedItems ?? firstPageData.items ?? []
    }

    return []
  }

  /**
   * Lookup an actor by their WebFinger address and return the actor URL
   */
  async lookupActorUrl(acct: string): Promise<string | null> {
    const webfinger = await this.webfinger(acct)
    if (!webfinger) return null

    const selfLink = webfinger.links.find(
      (link) =>
        link.rel === 'self' &&
        (link.type === 'application/activity+json' ||
          link.type ===
            'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'),
    )

    return selfLink?.href ?? null
  }
}
