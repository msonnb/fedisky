import { describe, it, expect, vi } from 'vitest'
import { setupE2E, uniqueId } from './setup'

describe('Actor Discovery', () => {
  const getCtx = setupE2E()

  it('should resolve WebFinger for PDS user', async () => {
    const ctx = getCtx()
    const username = `alice${uniqueId()}`
    const handle = `${username}.bsky.test`

    // Create user on PDS
    await ctx.pds.createAccount(handle, 'password123')

    // Query WebFinger via Fedisky (username@hostname format)
    const result = await ctx.fedisky.webfinger(`${username}@bsky.test`)

    expect(result).toBeDefined()
    expect(result!.subject).toContain(username)
    expect(result!.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rel: 'self',
          type: expect.stringContaining('activity'),
        }),
      ]),
    )
  })

  it('should return valid ActivityPub actor', async () => {
    const ctx = getCtx()
    const username = `bob${uniqueId()}`
    const handle = `${username}.bsky.test`

    // Create user on PDS
    const { did } = await ctx.pds.createAccount(handle, 'password123')

    // Get actor from Fedisky
    const actor = await ctx.fedisky.getActor(did)

    expect(actor).toBeDefined()
    expect(actor!.type).toBe('Person')
    expect(actor!.inbox).toBeDefined()
    expect(actor!.outbox).toBeDefined()
    expect(actor!.publicKey).toBeDefined()
    expect(actor!.publicKey!.publicKeyPem).toContain('BEGIN PUBLIC KEY')
  })

  it('should be discoverable from mock AP server via resolve', async () => {
    const ctx = getCtx()
    const username = `charlie${uniqueId()}`
    const handle = `${username}.bsky.test`

    // Create user on PDS
    await ctx.pds.createAccount(handle, 'password123')

    // Resolve the PDS user from the mock AP server
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

    expect(resolved).toBeDefined()
    expect(resolved.username).toBe(username)
    expect(resolved.id).toContain('bsky.test')
  })

  it('should hide bridge account from WebFinger discovery', async () => {
    const ctx = getCtx()

    // Try to lookup the bridge account (username is 'bridge')
    const result = await ctx.fedisky.webfinger('bridge@bsky.test')

    // Should return null (not found) for the bridge account
    expect(result).toBeNull()
  })

  it('should sync profile data correctly', async () => {
    const ctx = getCtx()
    const username = `prof${uniqueId()}`
    const handle = `${username}.bsky.test`
    const displayName = 'Test Display Name'
    const description = 'This is a test bio for E2E testing.'

    // Create user and update profile
    const { did, accessJwt } = await ctx.pds.createAccount(
      handle,
      'password123',
    )
    await ctx.pds.updateProfile(accessJwt, displayName, description)

    // Get actor and verify profile data
    // Use vi.waitFor since profile update may take a moment to propagate
    const actor = await vi.waitFor(
      async () => {
        const a = await ctx.fedisky.getActor(did)
        if (!a || !a.name) throw new Error('Profile not synced yet')
        return a
      },
      { timeout: 10000, interval: 1000 },
    )

    expect(actor.name).toBe(displayName)
    expect(actor.summary).toContain(description)
  })
})
