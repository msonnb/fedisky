import { describe, it, expect, vi } from 'vitest'
import { setupE2E, uniqueId } from './setup'

describe('Post Federation', () => {
  const getCtx = setupE2E()

  it('should deliver new post to mock AP follower', async () => {
    const ctx = getCtx()
    const username = `poster${uniqueId()}`
    const pdsHandle = `${username}.bsky.test`
    const mockApUser = 'reader' // Pre-seeded user
    const postContent = `Hello from Bluesky! ${uniqueId()}`

    // Create PDS user
    const { accessJwt } = await ctx.pds.createAccount(pdsHandle, 'password123')

    // Get mock AP user
    const { accessToken } = await ctx.mockAp.getUser(mockApUser)

    // Resolve and follow the PDS user
    const resolved = await vi.waitFor(
      async () => {
        const account = await ctx.mockAp.resolve(`${username}@bsky.test`)
        if (!account) throw new Error('Account not found yet')
        return account
      },
      { timeout: 30000, interval: 2000 },
    )

    await ctx.mockAp.follow(resolved.id, accessToken)

    // Wait for follow to be accepted (check for Accept activity)
    await vi.waitFor(
      async () => {
        const activities = await ctx.mockAp.getReceivedActivities(
          mockApUser,
          'Accept',
        )
        if (activities.length === 0) throw new Error('Follow not accepted yet')
        return true
      },
      { timeout: 30000, interval: 2000 },
    )

    // Create post on PDS (this triggers the firehose -> Fedisky -> mock AP flow)
    await ctx.pds.createPost(accessJwt, postContent)

    // Wait for Create activity to be received by mock AP server
    const createActivity = await vi.waitFor(
      async () => {
        const activities = await ctx.mockAp.getReceivedActivities(
          undefined,
          'Create',
        )
        const found = activities.find((a) => {
          const raw = JSON.stringify(a.raw)
          return raw.includes(postContent)
        })
        if (!found) throw new Error('Post not delivered yet')
        return found
      },
      { timeout: 60000, interval: 3000 },
    )

    expect(createActivity).toBeDefined()
    expect(createActivity.type).toBe('Create')
  })

  it('should show post in actors outbox', async () => {
    const ctx = getCtx()
    const username = `obox${uniqueId()}`
    const pdsHandle = `${username}.bsky.test`
    const postContent = `Outbox test post ${uniqueId()}`

    // Create PDS user and post
    const { did, accessJwt } = await ctx.pds.createAccount(
      pdsHandle,
      'password123',
    )
    await ctx.pds.createPost(accessJwt, postContent)

    // Check the actor's outbox contains the post
    const outbox = await vi.waitFor(
      async () => {
        const items = await ctx.fedisky.getOutbox(did)
        if (items.length === 0) {
          throw new Error('Outbox is empty')
        }
        return items
      },
      { timeout: 30000, interval: 2000 },
    )

    expect(outbox.length).toBeGreaterThan(0)

    // Check if any activity contains our post content
    const hasPost = outbox.some((activity) => {
      const activityStr = JSON.stringify(activity)
      return activityStr.includes(postContent)
    })
    expect(hasPost).toBe(true)
  })

  it('should send Delete activity when post is deleted', async () => {
    const ctx = getCtx()
    const username = `deleter${uniqueId()}`
    const pdsHandle = `${username}.bsky.test`
    const mockApUser = 'watcher' // Pre-seeded user
    const postContent = `This will be deleted ${uniqueId()}`

    // Create users
    const { accessJwt } = await ctx.pds.createAccount(pdsHandle, 'password123')
    const { accessToken } = await ctx.mockAp.getUser(mockApUser)

    // Resolve and follow the PDS user
    const resolved = await vi.waitFor(
      async () => {
        const account = await ctx.mockAp.resolve(`${username}@bsky.test`)
        if (!account) throw new Error('Account not found yet')
        return account
      },
      { timeout: 30000, interval: 2000 },
    )

    await ctx.mockAp.follow(resolved.id, accessToken)

    // Wait for follow to be accepted
    await vi.waitFor(
      async () => {
        const activities = await ctx.mockAp.getReceivedActivities(
          mockApUser,
          'Accept',
        )
        if (activities.length === 0) throw new Error('Follow not accepted yet')
        return true
      },
      { timeout: 30000, interval: 2000 },
    )

    // Create post and wait for it to be delivered
    const { uri } = await ctx.pds.createPost(accessJwt, postContent)

    await vi.waitFor(
      async () => {
        const activities = await ctx.mockAp.getReceivedActivities(
          undefined,
          'Create',
        )
        const found = activities.find((a) => {
          const raw = JSON.stringify(a.raw)
          return raw.includes(postContent)
        })
        if (!found) throw new Error('Post not delivered yet')
        return found
      },
      { timeout: 60000, interval: 3000 },
    )

    // Delete the post on PDS
    await ctx.pds.deleteRecord(accessJwt, uri)

    // Wait for Delete activity to be received
    const deleteActivity = await vi.waitFor(
      async () => {
        const activities = await ctx.mockAp.getReceivedActivities(
          undefined,
          'Delete',
        )
        if (activities.length === 0) throw new Error('Delete not received yet')
        return activities[0]
      },
      { timeout: 60000, interval: 3000 },
    )

    expect(deleteActivity).toBeDefined()
    expect(deleteActivity.type).toBe('Delete')
  })

  it('should include post in outbox after creation', async () => {
    const ctx = getCtx()
    const username = `stat${uniqueId()}`
    const pdsHandle = `${username}.bsky.test`
    const postContent = `Outbox inclusion test ${uniqueId()}`

    // Create PDS user
    const { did, accessJwt } = await ctx.pds.createAccount(
      pdsHandle,
      'password123',
    )

    // Create the post
    await ctx.pds.createPost(accessJwt, postContent)

    // Wait for post to appear in outbox
    const outbox = await vi.waitFor(
      async () => {
        const items = await ctx.fedisky.getOutbox(did)
        const found = items.find((activity) => {
          const activityStr = JSON.stringify(activity)
          return activityStr.includes(postContent)
        })
        if (!found) throw new Error('Post not in outbox yet')
        return items
      },
      { timeout: 60000, interval: 3000 },
    )

    const post = outbox.find((activity) => {
      const activityStr = JSON.stringify(activity)
      return activityStr.includes(postContent)
    })
    expect(post).toBeDefined()
  })
})
