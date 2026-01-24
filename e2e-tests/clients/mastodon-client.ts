import { execSync } from 'node:child_process'
import { httpRequest, type HttpResponse } from './http-client'

/**
 * Mastodon Test Client for E2E tests
 *
 * Provides methods to interact with a Mastodon instance for testing purposes.
 */

export interface MastodonAccount {
  id: string
  username: string
  acct: string
  display_name: string
  url: string
}

export interface MastodonStatus {
  id: string
  content: string
  account: MastodonAccount
  created_at: string
  in_reply_to_id: string | null
}

export interface MastodonRelationship {
  id: string
  following: boolean
  followed_by: boolean
  requested: boolean
}

export interface MastodonSearchResult {
  accounts: MastodonAccount[]
  statuses: MastodonStatus[]
}

export interface MastodonApplication {
  id: string
  client_id: string
  client_secret: string
}

export class MastodonClient {
  private baseUrl: string
  private host: string
  private app: MastodonApplication | null = null

  constructor(baseUrl: string, host: string) {
    this.baseUrl = baseUrl
    this.host = host
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
   * Wait for Mastodon health endpoint to respond
   */
  async waitForHealth(timeoutMs: number = 120000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await this.fetch('/health')
        if (res.ok) return
      } catch {
        // Service not ready yet
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error(`Mastodon health check timed out after ${timeoutMs}ms`)
  }

  /**
   * Create an OAuth application (needed for user registration and login)
   */
  async createApplication(): Promise<MastodonApplication> {
    if (this.app) return this.app

    const res = await this.fetch('/api/v1/apps', {
      method: 'POST',
      body: JSON.stringify({
        client_name: 'E2E Test Client',
        redirect_uris: 'urn:ietf:wg:oauth:2.0:oob',
        scopes: 'read write follow',
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to create application: ${res.status} ${text}`)
    }
    this.app = (await res.json()) as MastodonApplication
    return this.app
  }

  /**
   * Get an app-level access token using client_credentials grant.
   * This is needed to register new users via the API.
   */
  async getAppToken(): Promise<string> {
    const app = await this.createApplication()

    const res = await this.fetch('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: app.client_id,
        client_secret: app.client_secret,
        scope: 'read write follow',
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to get app token: ${res.status} ${text}`)
    }
    const data = (await res.json()) as { access_token: string }
    return data.access_token
  }

  /**
   * Create a new user account via tootctl.
   * This bypasses API rate limiting and creates a confirmed account.
   */
  async createUser(
    username: string,
    email: string,
    password: string,
  ): Promise<{ accessToken: string }> {
    // Create user via tootctl to bypass rate limiting
    // The --confirmed flag skips email verification
    execSync(
      `docker exec e2e-tests-mastodon-web-1 bundle exec tootctl accounts create ${username} --email=${email} --confirmed`,
      { stdio: 'pipe' },
    )

    // Set the user's password via Rails console
    execSync(
      `docker exec e2e-tests-mastodon-web-1 bundle exec rails runner "User.find_by(email: '${email}').update!(password: '${password}')"`,
      { stdio: 'pipe' },
    )

    // Get access token via OAuth password grant
    return this.getAccessToken(email, password)
  }

  /**
   * Get access token using password grant
   */
  async getAccessToken(
    email: string,
    password: string,
    app?: MastodonApplication,
  ): Promise<{ accessToken: string }> {
    const application = app ?? (await this.createApplication())

    const res = await this.fetch('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'password',
        client_id: application.client_id,
        client_secret: application.client_secret,
        username: email,
        password,
        scope: 'read write follow',
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to get access token: ${res.status} ${text}`)
    }
    const data = (await res.json()) as { access_token: string }
    return { accessToken: data.access_token }
  }

  /**
   * Search for accounts or statuses
   */
  async search(
    query: string,
    token: string,
    opts: { resolve?: boolean; type?: 'accounts' | 'statuses' } = {},
  ): Promise<MastodonSearchResult> {
    const params = new URLSearchParams({
      q: query,
      resolve: String(opts.resolve ?? true),
    })
    if (opts.type) {
      params.set('type', opts.type)
    }

    const res = await this.fetch(`/api/v2/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Search failed: ${res.status} ${text}`)
    }
    return res.json() as Promise<MastodonSearchResult>
  }

  /**
   * Follow an account
   */
  async follow(
    accountId: string,
    token: string,
  ): Promise<MastodonRelationship> {
    const res = await this.fetch(`/api/v1/accounts/${accountId}/follow`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Follow failed: ${res.status} ${text}`)
    }
    return res.json() as Promise<MastodonRelationship>
  }

  /**
   * Unfollow an account
   */
  async unfollow(
    accountId: string,
    token: string,
  ): Promise<MastodonRelationship> {
    const res = await this.fetch(`/api/v1/accounts/${accountId}/unfollow`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Unfollow failed: ${res.status} ${text}`)
    }
    return res.json() as Promise<MastodonRelationship>
  }

  /**
   * Get relationship with an account
   */
  async getRelationship(
    accountId: string,
    token: string,
  ): Promise<MastodonRelationship> {
    const res = await this.fetch(
      `/api/v1/accounts/relationships?id[]=${accountId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Get relationship failed: ${res.status} ${text}`)
    }
    const data = (await res.json()) as MastodonRelationship[]
    return data[0]
  }

  /**
   * Get home timeline
   */
  async getHomeTimeline(token: string): Promise<MastodonStatus[]> {
    const res = await this.fetch('/api/v1/timelines/home', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Get timeline failed: ${res.status} ${text}`)
    }
    return res.json() as Promise<MastodonStatus[]>
  }

  /**
   * Create a status (post)
   */
  async createStatus(content: string, token: string): Promise<MastodonStatus> {
    const res = await this.fetch('/api/v1/statuses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: content }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Create status failed: ${res.status} ${text}`)
    }
    return res.json() as Promise<MastodonStatus>
  }

  /**
   * Reply to a status
   */
  async replyToStatus(
    statusId: string,
    content: string,
    token: string,
  ): Promise<MastodonStatus> {
    const res = await this.fetch('/api/v1/statuses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        status: content,
        in_reply_to_id: statusId,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Reply failed: ${res.status} ${text}`)
    }
    return res.json() as Promise<MastodonStatus>
  }

  /**
   * Get an account's statuses
   */
  async getAccountStatuses(
    accountId: string,
    token: string,
  ): Promise<MastodonStatus[]> {
    const res = await this.fetch(`/api/v1/accounts/${accountId}/statuses`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Get statuses failed: ${res.status} ${text}`)
    }
    return res.json() as Promise<MastodonStatus[]>
  }

  /**
   * Verify credentials (get current user)
   */
  async verifyCredentials(token: string): Promise<MastodonAccount> {
    const res = await this.fetch('/api/v1/accounts/verify_credentials', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Verify credentials failed: ${res.status} ${text}`)
    }
    return res.json() as Promise<MastodonAccount>
  }
}
