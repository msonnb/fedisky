/**
 * Test inspection API routes for mock ActivityPub server
 */

import { Actor, Follow, Undo, isActor, lookupObject } from '@fedify/vocab'
import type { Router } from 'express'
import { Router as createRouter } from 'express'
import type { Config } from './config'
import type { FederationContext } from './federation'
import {
  addFollowing,
  getFollowers,
  getFollowing,
  getInboxActivities,
  nextActivityId,
  removeFollowing,
  resetState,
  type State,
} from './state'

/**
 * Convert a handle (user@host) or acct: URI to a proper acct: URI format.
 * This is needed because Fedify's lookupObject requires the acct: protocol.
 */
function toAcctUri(handle: string): string {
  // Already has acct: prefix
  if (handle.startsWith('acct:')) {
    return handle
  }
  // Remove @ prefix if present
  if (handle.startsWith('@')) {
    handle = handle.slice(1)
  }
  // Check if it's a handle format (user@host)
  if (handle.includes('@')) {
    return `acct:${handle}`
  }
  // Otherwise return as-is (might be a URL)
  return handle
}

export function createApiRouter(
  config: Config,
  state: State,
  fedCtx: FederationContext,
): Router {
  const router = createRouter()

  // Health check
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Get all received activities
  router.get('/api/inbox', (req, res) => {
    const type = req.query.type as string | undefined
    const activities = getInboxActivities(state, undefined, type)
    res.json(activities)
  })

  // Get activities received by a specific user
  router.get('/api/inbox/:username', (req, res) => {
    const { username } = req.params
    const type = req.query.type as string | undefined

    if (!config.users.includes(username)) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const activities = getInboxActivities(state, username, type)
    res.json(activities)
  })

  // Get followers of a user
  router.get('/api/followers/:username', (req, res) => {
    const { username } = req.params

    if (!config.users.includes(username)) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const followers = getFollowers(state, username)
    res.json(followers)
  })

  // Get accounts a user is following
  router.get('/api/following/:username', (req, res) => {
    const { username } = req.params

    if (!config.users.includes(username)) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const following = getFollowing(state, username)
    res.json(following)
  })

  // Make a user follow a remote actor
  router.post('/api/follow', async (req, res) => {
    const { username, target } = req.body as {
      username?: string
      target?: string
    }

    if (!username || !target) {
      res.status(400).json({ error: 'username and target required' })
      return
    }

    if (!config.users.includes(username)) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    try {
      // Lookup the target actor
      const ctx = fedCtx.federation.createContext(
        new URL(config.baseUrl),
        undefined,
      )

      const targetUri = toAcctUri(target)
      console.log(`[api] Looking up actor: ${targetUri}`)
      // allowPrivateAddress is needed for Docker network addresses but not typed in Fedify 1.x
      const targetObject = await lookupObject(targetUri, {
        documentLoader: ctx.documentLoader,
        allowPrivateAddress: true,
      } as Parameters<typeof lookupObject>[1])

      if (!targetObject || !isActor(targetObject) || !targetObject.id) {
        res.status(404).json({ error: 'Target actor not found' })
        return
      }

      const targetActor = targetObject as Actor
      if (!targetActor.inboxId) {
        res.status(400).json({ error: 'Target actor has no inbox' })
        return
      }

      console.log(
        `[api] Found actor: ${targetActor.id!.href}, inbox: ${targetActor.inboxId.href}`,
      )

      // Store the follow locally
      addFollowing(
        state,
        username,
        targetActor.id!.href,
        targetActor.inboxId.href,
      )

      // Send Follow activity
      const actorUri = ctx.getActorUri(username)
      const followActivity = new Follow({
        id: new URL(`${config.baseUrl}/activities/${nextActivityId(state)}`),
        actor: actorUri,
        object: targetActor.id!,
      })

      await ctx.sendActivity(
        { identifier: username },
        { id: targetActor.id!, inboxId: targetActor.inboxId },
        followActivity,
      )

      console.log(
        `[api] Sent Follow from ${username} to ${targetActor.id!.href}`,
      )

      res.json({
        success: true,
        actorUri: targetActor.id!.href,
        inbox: targetActor.inboxId.href,
      })
    } catch (err) {
      console.error('[api] Follow error:', err)
      res.status(500).json({ error: String(err) })
    }
  })

  // Make a user unfollow a remote actor
  router.post('/api/unfollow', async (req, res) => {
    const { username, target } = req.body as {
      username?: string
      target?: string
    }

    if (!username || !target) {
      res.status(400).json({ error: 'username and target required' })
      return
    }

    if (!config.users.includes(username)) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    try {
      const following = getFollowing(state, username)
      const followState = following.find((f) => f.actorUri === target)

      if (!followState) {
        res.status(400).json({ error: 'Not following this actor' })
        return
      }

      const ctx = fedCtx.federation.createContext(
        new URL(config.baseUrl),
        undefined,
      )

      // Remove from local state
      removeFollowing(state, username, target)

      // Send Undo(Follow) activity
      const actorUri = ctx.getActorUri(username)
      const undoActivity = new Undo({
        id: new URL(`${config.baseUrl}/activities/${nextActivityId(state)}`),
        actor: actorUri,
        object: new Follow({
          actor: actorUri,
          object: new URL(target),
        }),
      })

      await ctx.sendActivity(
        { identifier: username },
        { id: new URL(target), inboxId: new URL(followState.actorInbox) },
        undoActivity,
      )

      console.log(`[api] Sent Undo Follow from ${username} to ${target}`)

      res.json({ success: true })
    } catch (err) {
      console.error('[api] Unfollow error:', err)
      res.status(500).json({ error: String(err) })
    }
  })

  // Resolve a remote actor (WebFinger + fetch)
  router.post('/api/resolve', async (req, res) => {
    const { handle } = req.body as { handle?: string }

    if (!handle) {
      res.status(400).json({ error: 'handle required' })
      return
    }

    try {
      const ctx = fedCtx.federation.createContext(
        new URL(config.baseUrl),
        undefined,
      )

      const handleUri = toAcctUri(handle)
      console.log(`[api] Resolving actor: ${handleUri}`)
      // allowPrivateAddress is needed for Docker network addresses but not typed in Fedify 1.x
      const actorObject = await lookupObject(handleUri, {
        documentLoader: ctx.documentLoader,
        allowPrivateAddress: true,
      } as Parameters<typeof lookupObject>[1])

      console.log(`[api] lookupObject result:`, actorObject ? 'found' : 'null')

      if (!actorObject || !isActor(actorObject) || !actorObject.id) {
        console.log(
          `[api] Actor not found or invalid. isActor: ${actorObject ? isActor(actorObject) : 'null'}`,
        )
        res.status(404).json({ error: 'Actor not found' })
        return
      }

      const actor = actorObject as Actor

      res.json({
        id: actor.id!.href,
        name: actor.name?.toString(),
        preferredUsername: actor.preferredUsername,
        inbox: actor.inboxId?.href,
      })
    } catch (err) {
      console.error('[api] Resolve error:', err)
      res.status(500).json({ error: String(err) })
    }
  })

  // Reset all state (for test isolation)
  router.delete('/api/reset', (_req, res) => {
    resetState(state)
    console.log('[api] State reset')
    res.json({ success: true })
  })

  // List available users
  router.get('/api/users', (_req, res) => {
    res.json(config.users)
  })

  return router
}
