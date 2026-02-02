/**
 * Mock Constellation Server Client for E2E tests
 *
 * This client interacts with the mock-constellation-server which provides
 * Constellation API and AppView mock endpoints for testing external Bluesky
 * reply federation.
 */

export interface SeededReply {
  parentAtUri: string
  replyAtUri: string
  replyAuthorDid: string
  replyAuthorHandle: string
  replyText: string
  replyCid?: string
  replyCreatedAt?: string
}

export class MockConstellationClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private async fetch(
    path: string,
    options: {
      method?: string
      headers?: Record<string, string>
      body?: string
    } = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = { ...options.headers }
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }
    return fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    })
  }

  /**
   * Wait for mock Constellation server health endpoint to respond
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
      `Mock Constellation server health check timed out after ${timeoutMs}ms`,
    )
  }

  /**
   * Seed a fake external reply for testing.
   *
   * This will cause the Constellation processor to discover this reply
   * when it polls for backlinks to the parent post.
   */
  async seedReply(
    reply: Omit<SeededReply, 'replyCid' | 'replyCreatedAt'>,
  ): Promise<SeededReply> {
    const res = await this.fetch('/api/seed-reply', {
      method: 'POST',
      body: JSON.stringify(reply),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Seed reply failed: ${res.status} ${text}`)
    }

    const data = (await res.json()) as { success: boolean; reply: SeededReply }
    return data.reply
  }

  /**
   * Get all seeded replies (for debugging)
   */
  async getReplies(): Promise<SeededReply[]> {
    const res = await this.fetch('/api/replies')
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Get replies failed: ${res.status} ${text}`)
    }
    return res.json() as Promise<SeededReply[]>
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
}
