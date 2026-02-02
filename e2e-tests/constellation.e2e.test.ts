import { describe, it, expect, vi } from 'vitest'
import { setupE2E, uniqueId } from './setup'

describe('External Bluesky Reply Federation (Constellation)', () => {
  const getCtx = setupE2E()

  it('should federate external Bluesky reply to AP followers', async () => {
    const ctx = getCtx()
    const username = `cuser${uniqueId()}`
    const pdsHandle = `${username}.bsky.test`
    const mockApUser = 'viewer' // Pre-seeded user in mock-ap
    const postContent = `Original post for constellation test ${uniqueId()}`

    // External Bluesky user details (fake)
    const externalDid = `did:plc:external${uniqueId()}`
    const externalHandle = `external${uniqueId()}.bsky.social`
    const replyText = `This is an external reply ${uniqueId()}`

    // 1. Create local PDS user
    const { accessJwt } = await ctx.pds.createAccount(pdsHandle, 'password123')

    // 2. Get mock AP user and have them follow the local PDS user
    const { accessToken } = await ctx.mockAp.getUser(mockApUser)

    // Resolve the PDS user from mock AP
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

    // 3. Local user creates a post
    const { uri: postUri } = await ctx.pds.createPost(accessJwt, postContent)

    // 4. Wait for post to be delivered to mock AP (confirms firehose works)
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
        if (!found) throw new Error('Original post not delivered yet')
        return found
      },
      { timeout: 60000, interval: 3000 },
    )

    // 5. Seed a fake external reply via mock-constellation
    const replyRkey = `reply${uniqueId()}`
    const replyAtUri = `at://${externalDid}/app.bsky.feed.post/${replyRkey}`

    await ctx.mockConstellation.seedReply({
      parentAtUri: postUri,
      replyAtUri,
      replyAuthorDid: externalDid,
      replyAuthorHandle: externalHandle,
      replyText,
    })

    // 6. Wait for Create activity containing the reply to arrive at mock AP
    // The Constellation processor polls every 5 seconds, so we need to wait
    const replyActivity = await vi.waitFor(
      async () => {
        const activities = await ctx.mockAp.getReceivedActivities(
          undefined,
          'Create',
        )
        const found = activities.find((a) => {
          const raw = JSON.stringify(a.raw)
          return raw.includes(replyText)
        })
        if (!found) throw new Error('External reply not federated yet')
        return found
      },
      { timeout: 60000, interval: 3000 },
    )

    // 7. Verify the activity
    expect(replyActivity).toBeDefined()
    expect(replyActivity.type).toBe('Create')

    // 8. Verify the content includes attribution
    const rawStr = JSON.stringify(replyActivity.raw)
    expect(rawStr).toContain(replyText)
    expect(rawStr).toContain(externalHandle)
    expect(rawStr).toContain('replied')

    // 9. Verify it's from the bridge account (actor should be a valid URI)
    expect(replyActivity.actor).toContain('bsky.test/users/')
  })
})
