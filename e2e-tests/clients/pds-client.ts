import { httpRequest, type HttpResponse } from './http-client'

/**
 * PDS Test Client for E2E tests
 *
 * Provides methods to interact with an ATProto PDS for testing purposes.
 */
export class PDSTestClient {
  private baseUrl: string
  private host: string
  private adminToken: string

  constructor(baseUrl: string, adminToken: string = 'admin-password') {
    this.baseUrl = baseUrl
    this.host = new URL(baseUrl).hostname
    this.adminToken = adminToken
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
    if (!headers['Content-Type'] && options.body) {
      headers['Content-Type'] = 'application/json'
    }
    return httpRequest(url, this.host, { ...options, headers })
  }

  /**
   * Wait for the PDS health endpoint to respond
   */
  async waitForHealth(timeoutMs: number = 60000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await this.fetch('/xrpc/_health')
        if (res.ok) return
      } catch {
        // Service not ready yet
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error(`PDS health check timed out after ${timeoutMs}ms`)
  }

  /**
   * Create an invite code (requires admin token)
   */
  async createInviteCode(useCount: number = 1): Promise<string> {
    const res = await this.fetch('/xrpc/com.atproto.server.createInviteCode', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`admin:${this.adminToken}`).toString('base64')}`,
      },
      body: JSON.stringify({ useCount }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to create invite code: ${res.status} ${text}`)
    }
    const data = (await res.json()) as { code: string }
    return data.code
  }

  /**
   * Create a new account on the PDS
   */
  async createAccount(
    handle: string,
    password: string,
    inviteCode?: string,
  ): Promise<{
    did: string
    handle: string
    accessJwt: string
    refreshJwt: string
  }> {
    // Get invite code if not provided
    const code = inviteCode ?? (await this.createInviteCode())

    const res = await this.fetch('/xrpc/com.atproto.server.createAccount', {
      method: 'POST',
      body: JSON.stringify({
        handle,
        password,
        inviteCode: code,
        email: `${handle.replace('.', '-')}@test.local`,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to create account: ${res.status} ${text}`)
    }
    return res.json() as Promise<{
      did: string
      handle: string
      accessJwt: string
      refreshJwt: string
    }>
  }

  /**
   * Create a session (login) for an existing account
   */
  async createSession(
    identifier: string,
    password: string,
  ): Promise<{ accessJwt: string; refreshJwt: string; did: string }> {
    const res = await this.fetch('/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to create session: ${res.status} ${text}`)
    }
    return res.json() as Promise<{
      accessJwt: string
      refreshJwt: string
      did: string
    }>
  }

  /**
   * Create a post on the PDS
   */
  async createPost(
    accessJwt: string,
    text: string,
    opts: {
      reply?: {
        root: { uri: string; cid: string }
        parent: { uri: string; cid: string }
      }
    } = {},
  ): Promise<{ uri: string; cid: string }> {
    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
    }
    if (opts.reply) {
      record.reply = opts.reply
    }

    const res = await this.fetch('/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessJwt}`,
      },
      body: JSON.stringify({
        repo: await this.getDidFromToken(accessJwt),
        collection: 'app.bsky.feed.post',
        record,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to create post: ${res.status} ${text}`)
    }
    return res.json() as Promise<{ uri: string; cid: string }>
  }

  /**
   * Delete a record
   */
  async deleteRecord(accessJwt: string, uri: string): Promise<void> {
    // Parse AT URI: at://did/collection/rkey
    const parts = uri.replace('at://', '').split('/')
    const [repo, collection, rkey] = parts

    const res = await this.fetch('/xrpc/com.atproto.repo.deleteRecord', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessJwt}`,
      },
      body: JSON.stringify({ repo, collection, rkey }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to delete record: ${res.status} ${text}`)
    }
  }

  /**
   * Update profile
   */
  async updateProfile(
    accessJwt: string,
    displayName: string,
    description: string,
  ): Promise<void> {
    const did = await this.getDidFromToken(accessJwt)

    // Get existing profile first
    let existingProfile: Record<string, unknown> = {}
    try {
      const getRes = await this.fetch(
        `/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.actor.profile&rkey=self`,
        {
          headers: { Authorization: `Bearer ${accessJwt}` },
        },
      )
      if (getRes.ok) {
        const data = (await getRes.json()) as { value: Record<string, unknown> }
        existingProfile = data.value
      }
    } catch {
      // No existing profile, that's fine
    }

    const record = {
      ...existingProfile,
      $type: 'app.bsky.actor.profile',
      displayName,
      description,
    }

    const res = await this.fetch('/xrpc/com.atproto.repo.putRecord', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessJwt}`,
      },
      body: JSON.stringify({
        repo: did,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
        record,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to update profile: ${res.status} ${text}`)
    }
  }

  /**
   * Resolve handle to DID
   */
  async resolveHandle(handle: string): Promise<string | null> {
    const res = await this.fetch(
      `/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
    )
    if (!res.ok) {
      if (res.status === 404) return null
      const text = await res.text()
      throw new Error(`Failed to resolve handle: ${res.status} ${text}`)
    }
    const data = (await res.json()) as { did: string }
    return data.did
  }

  /**
   * Get DID from access token by calling getSession
   */
  private async getDidFromToken(accessJwt: string): Promise<string> {
    const res = await this.fetch('/xrpc/com.atproto.server.getSession', {
      headers: { Authorization: `Bearer ${accessJwt}` },
    })
    if (!res.ok) {
      throw new Error('Failed to get session from token')
    }
    const data = (await res.json()) as { did: string }
    return data.did
  }
}
