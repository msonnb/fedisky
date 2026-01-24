import { describe, it, expect, vi } from 'vitest'
import { setupE2E, uniqueId } from './setup'

describe('Follow Federation', () => {
  const getCtx = setupE2E()

  it('should accept follow from mock AP user', async () => {
    const ctx = getCtx()
    const username = `followee${uniqueId()}`
    const pdsHandle = `${username}.bsky.test`
    const mockApUser = 'follower' // Pre-seeded user in mock-ap-server

    // Create PDS user
    const { did } = await ctx.pds.createAccount(pdsHandle, 'password123')

    // Get the mock AP user token (just returns the username as token)
    const { accessToken } = await ctx.mockAp.getUser(mockApUser)

    // Resolve the PDS user from the mock AP server first
    const resolved = await vi.waitFor(
      async () => {
        const account = await ctx.mockAp.resolve(`${username}@bsky.test`)
        if (!account) {
          throw new Error('Account not found yet')
        }
        return account
      },
      { timeout: 30000, interval: 2000 },
    )

    // Follow the PDS user (using the actor URI)
    await ctx.mockAp.follow(resolved.id, accessToken)

    // Wait for the follow to be recorded in Fedisky (Accept was sent)
    const followers = await vi.waitFor(
      async () => {
        const f = await ctx.fedisky.getFollowers(did)
        if (f.length === 0) {
          throw new Error('Follower not recorded yet')
        }
        return f
      },
      { timeout: 30000, interval: 2000 },
    )

    expect(followers.length).toBeGreaterThan(0)

    // Verify we received an Accept activity back
    const hasAccept = await vi.waitFor(
      async () => {
        const activities = await ctx.mockAp.getReceivedActivities(
          mockApUser,
          'Accept',
        )
        if (activities.length === 0) {
          throw new Error('Accept not received yet')
        }
        return true
      },
      { timeout: 15000, interval: 1000 },
    )

    expect(hasAccept).toBe(true)
  })

  it('should process unfollow correctly', async () => {
    const ctx = getCtx()
    const username = `ufee${uniqueId()}`
    const pdsHandle = `${username}.bsky.test`
    const mockApUser = 'ufer' // Pre-seeded user in mock-ap-server

    // Setup: Create PDS user
    const { did } = await ctx.pds.createAccount(pdsHandle, 'password123')

    // Get mock AP user
    const { accessToken } = await ctx.mockAp.getUser(mockApUser)

    // Resolve and follow
    const resolved = await vi.waitFor(
      async () => {
        const account = await ctx.mockAp.resolve(`${username}@bsky.test`)
        if (!account) throw new Error('Account not found yet')
        return account
      },
      { timeout: 30000, interval: 2000 },
    )

    await ctx.mockAp.follow(resolved.id, accessToken)

    // Wait for follow to be recorded
    await vi.waitFor(
      async () => {
        const f = await ctx.fedisky.getFollowers(did)
        if (f.length === 0) throw new Error('Follower not recorded yet')
        return f
      },
      { timeout: 30000, interval: 2000 },
    )

    // Now unfollow
    await ctx.mockAp.unfollow(resolved.id, accessToken)

    // Verify follower is removed from Fedisky
    const followers = await vi.waitFor(
      async () => {
        const f = await ctx.fedisky.getFollowers(did)
        if (f.length > 0) {
          throw new Error('Follower still recorded')
        }
        return f
      },
      { timeout: 15000, interval: 1000 },
    )

    expect(followers).toHaveLength(0)
  })

  it('should handle multiple followers', async () => {
    const ctx = getCtx()
    const username = `popular${uniqueId()}`
    const pdsHandle = `${username}.bsky.test`

    // Create PDS user
    const { did } = await ctx.pds.createAccount(pdsHandle, 'password123')

    // Get two mock AP users
    const { accessToken: token1 } = await ctx.mockAp.getUser('fan1')
    const { accessToken: token2 } = await ctx.mockAp.getUser('fan2')

    // Resolve the PDS user
    const resolved = await vi.waitFor(
      async () => {
        const account = await ctx.mockAp.resolve(`${username}@bsky.test`)
        if (!account) throw new Error('Not found')
        return account
      },
      { timeout: 30000, interval: 2000 },
    )

    // Follow from both users
    await ctx.mockAp.follow(resolved.id, token1)
    await ctx.mockAp.follow(resolved.id, token2)

    // Wait for both follows to be recorded
    const followers = await vi.waitFor(
      async () => {
        const f = await ctx.fedisky.getFollowers(did)
        if (f.length < 2) {
          throw new Error(`Only ${f.length} followers recorded`)
        }
        return f
      },
      { timeout: 30000, interval: 2000 },
    )

    expect(followers.length).toBeGreaterThanOrEqual(2)
  })
})
