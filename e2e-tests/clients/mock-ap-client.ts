import { httpRequest, type HttpResponse } from './http-client'

/**
 * Mock ActivityPub Server Client for E2E tests
 *
 * This client interacts with the mock-ap-server which provides a minimal
 * ActivityPub implementation for testing Fedisky federation.
 */

export interface MockAPAccount {
  id: string
  username: string
  name?: string
  inbox: string
}

export interface StoredActivity {
  id: string
  type: string
  actor: string
  object?: unknown
  target?: string
  receivedAt: string
  recipient: string
  raw: unknown
}

export interface FollowState {
  actorUri: string
  actorInbox: string
  followedAt: string
}

export class MockAPClient {
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
    if (
      !headers['Content-Type'] &&
      options.body &&
      typeof options.body === 'string'
    ) {
      headers['Content-Type'] = 'application/json'
    }
    return httpRequest(url, this.host, { ...options, headers })
  }

  /**
   * Wait for mock AP server health endpoint to respond
   */
  async waitForHealth(timeoutMs: number = 30000): Promise<void> {
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
    throw new Error(
      `Mock AP server health check timed out after ${timeoutMs}ms`,
    )
  }

  /**
   * Get a user. Users are pre-seeded, so this just returns the username as the token.
   * This provides a similar interface to the old MastodonClient.createUser().
   */
  async getUser(username: string): Promise<{ accessToken: string }> {
    // Verify the user exists
    const res = await this.fetch('/api/users')
    if (!res.ok) {
      throw new Error(`Failed to get users: ${res.status}`)
    }
    const users = (await res.json()) as string[]
    if (!users.includes(username)) {
      throw new Error(
        `User ${username} not found. Available: ${users.join(', ')}`,
      )
    }
    // The "token" is just the username for this mock server
    return { accessToken: username }
  }

  /**
   * Resolve a remote actor by handle (WebFinger + fetch)
   */
  async resolve(handle: string): Promise<MockAPAccount | null> {
    const res = await this.fetch('/api/resolve', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    })

    if (!res.ok) {
      if (res.status === 404) return null
      const text = await res.text()
      throw new Error(`Resolve failed: ${res.status} ${text}`)
    }

    const data = (await res.json()) as {
      id: string
      name?: string
      preferredUsername?: string
      inbox?: string
    }

    return {
      id: data.id,
      username: data.preferredUsername || handle.split('@')[0],
      name: data.name,
      inbox: data.inbox || '',
    }
  }

  /**
   * Search for and resolve a remote actor.
   * Compatible with old MastodonClient.search() interface.
   */
  async search(
    query: string,
    _token: string,
    opts: { resolve?: boolean; type?: 'accounts' | 'statuses' } = {},
  ): Promise<{ accounts: MockAPAccount[]; statuses: never[] }> {
    if (opts.type === 'statuses') {
      return { accounts: [], statuses: [] }
    }

    if (!opts.resolve) {
      return { accounts: [], statuses: [] }
    }

    const account = await this.resolve(query)
    return {
      accounts: account ? [account] : [],
      statuses: [],
    }
  }

  /**
   * Make a mock user follow a remote actor
   */
  async follow(targetHandle: string, token: string): Promise<void> {
    const res = await this.fetch('/api/follow', {
      method: 'POST',
      body: JSON.stringify({ username: token, target: targetHandle }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Follow failed: ${res.status} ${text}`)
    }
  }

  /**
   * Make a mock user unfollow a remote actor
   */
  async unfollow(targetActorUri: string, token: string): Promise<void> {
    const res = await this.fetch('/api/unfollow', {
      method: 'POST',
      body: JSON.stringify({ username: token, target: targetActorUri }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Unfollow failed: ${res.status} ${text}`)
    }
  }

  /**
   * Get all received activities, optionally filtered by recipient and/or type
   */
  async getReceivedActivities(
    recipient?: string,
    type?: string,
  ): Promise<StoredActivity[]> {
    const path = recipient ? `/api/inbox/${recipient}` : '/api/inbox'
    const params = type ? `?type=${encodeURIComponent(type)}` : ''

    const res = await this.fetch(`${path}${params}`)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Get inbox failed: ${res.status} ${text}`)
    }

    return res.json() as Promise<StoredActivity[]>
  }

  /**
   * Get followers of a mock user
   */
  async getFollowers(username: string): Promise<FollowState[]> {
    const res = await this.fetch(`/api/followers/${username}`)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Get followers failed: ${res.status} ${text}`)
    }

    return res.json() as Promise<FollowState[]>
  }

  /**
   * Get accounts a mock user is following
   */
  async getFollowing(username: string): Promise<FollowState[]> {
    const res = await this.fetch(`/api/following/${username}`)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Get following failed: ${res.status} ${text}`)
    }

    return res.json() as Promise<FollowState[]>
  }

  /**
   * Reset all server state (call between tests for isolation)
   */
  async reset(): Promise<void> {
    const res = await this.fetch('/api/reset', { method: 'DELETE' })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Reset failed: ${res.status} ${text}`)
    }
  }

  /**
   * Check if an activity of a given type was received
   */
  async hasReceivedActivity(
    type: string,
    predicate?: (activity: StoredActivity) => boolean,
  ): Promise<boolean> {
    const activities = await this.getReceivedActivities(undefined, type)
    if (predicate) {
      return activities.some(predicate)
    }
    return activities.length > 0
  }

  /**
   * Wait for an activity of a given type to be received
   */
  async waitForActivity(
    type: string,
    predicate?: (activity: StoredActivity) => boolean,
    timeoutMs: number = 30000,
    intervalMs: number = 1000,
  ): Promise<StoredActivity> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const activities = await this.getReceivedActivities(undefined, type)
      const found = predicate ? activities.find(predicate) : activities[0]
      if (found) return found
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    throw new Error(`Timeout waiting for ${type} activity`)
  }
}
