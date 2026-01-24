/**
 * Fedify federation setup for mock ActivityPub server
 */

import {
  Accept,
  Create,
  createFederation,
  Delete,
  type Federation,
  Follow,
  generateCryptoKeyPair,
  type KvStore,
  MemoryKvStore,
  Note,
  Person,
  Undo,
} from '@fedify/fedify'
import type { Config } from './config'
import {
  addFollower,
  addInboxActivity,
  nextActivityId,
  removeFollower,
  type State,
  type StoredActivity,
} from './state'

/** In-memory store for generated keypairs */
const keypairStore = new Map<
  string,
  { privateKey: CryptoKey; publicKey: CryptoKey }[]
>()

export interface FederationContext {
  federation: Federation<void>
  kv: KvStore
}

export function setupFederation(
  config: Config,
  state: State,
): FederationContext {
  const kv = new MemoryKvStore()

  const federation = createFederation<void>({
    kv,
    allowPrivateAddress: true,
  })

  // Setup actor dispatcher
  federation
    .setActorDispatcher('/users/{identifier}', async (ctx, identifier) => {
      if (!config.users.includes(identifier)) {
        return null
      }

      const keyPairs = await ctx.getActorKeyPairs(identifier)

      return new Person({
        id: ctx.getActorUri(identifier),
        name: identifier,
        preferredUsername: identifier,
        inbox: ctx.getInboxUri(identifier),
        outbox: ctx.getOutboxUri(identifier),
        followers: ctx.getFollowersUri(identifier),
        following: ctx.getFollowingUri(identifier),
        publicKey: keyPairs[0]?.cryptographicKey,
        assertionMethods: keyPairs.map((kp) => kp.multikey),
      })
    })
    .mapHandle(async (_ctx, handle) => {
      // Handle is username@hostname, extract username
      const username = handle.includes('@') ? handle.split('@')[0] : handle
      return config.users.includes(username) ? username : null
    })
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      if (!config.users.includes(identifier)) {
        return []
      }

      // Return cached keypairs or generate new ones
      if (!keypairStore.has(identifier)) {
        const rsaKeyPair = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5')
        keypairStore.set(identifier, [rsaKeyPair])
      }

      return keypairStore.get(identifier)!
    })

  // Setup inbox listeners
  federation
    .setInboxListeners('/users/{identifier}/inbox', '/inbox')
    .on(Follow, async (ctx, follow) => {
      const parsed = ctx.parseUri(follow.objectId)
      if (!parsed || parsed.type !== 'actor') {
        console.log(
          '[inbox] Follow: could not parse objectId',
          follow.objectId?.href,
        )
        return
      }

      const identifier = parsed.identifier
      const actor = await follow.getActor()
      if (!actor?.id || !actor.inboxId) {
        console.log('[inbox] Follow: could not get actor')
        return
      }

      console.log(`[inbox] Follow: ${actor.id.href} -> ${identifier}`)

      // Store follower
      addFollower(state, identifier, actor.id.href, actor.inboxId.href)

      // Record the activity
      const stored: StoredActivity = {
        id: `activity-${nextActivityId(state)}`,
        type: 'Follow',
        actor: actor.id.href,
        object: follow.objectId?.href,
        recipient: identifier,
        receivedAt: new Date().toISOString(),
        raw: await follow.toJsonLd(),
      }
      addInboxActivity(state, identifier, stored)

      // Send Accept
      const actorUri = ctx.getActorUri(identifier)
      await ctx.sendActivity(
        { identifier },
        actor,
        new Accept({
          id: new URL(`${config.baseUrl}/activities/${nextActivityId(state)}`),
          actor: actorUri,
          object: follow,
        }),
      )

      console.log(`[inbox] Sent Accept to ${actor.inboxId.href}`)
    })
    .on(Accept, async (_ctx, accept) => {
      try {
        console.log(`[inbox] Accept received: ${accept.id?.href}`)
        // Handle Accept activities (response to our Follow requests)
        const actor = await accept.getActor()
        // Don't call getObject() as it triggers a fetch to the remote server
        // for the original Follow activity which may not be dereferenceable.
        // Instead, use objectId directly.
        const objectId = accept.objectId

        console.log(
          `[inbox] Accept: from ${actor?.id?.href}, object: ${objectId?.href}`,
        )

        // Determine recipient - try to extract from the Accept's raw JSON-LD
        // The object should contain our original Follow with actor being our user
        let recipient = 'shared'
        const raw = await accept.toJsonLd()
        // Check if object contains an actor URI pointing to one of our users
        const obj = (raw as Record<string, unknown>).object
        if (obj && typeof obj === 'object') {
          const objRecord = obj as Record<string, unknown>
          const actorField = objRecord.actor
          // actorField can be a string URI or an object with id
          let actorUri: string | undefined
          if (typeof actorField === 'string') {
            actorUri = actorField
          } else if (
            actorField &&
            typeof actorField === 'object' &&
            'id' in actorField
          ) {
            actorUri = (actorField as { id: string }).id
          }
          if (actorUri) {
            const match = actorUri.match(/\/users\/(\w+)/)
            if (match && config.users.includes(match[1])) {
              recipient = match[1]
            }
          }
        }

        const stored: StoredActivity = {
          id: `activity-${nextActivityId(state)}`,
          type: 'Accept',
          actor: actor?.id?.href || 'unknown',
          object: objectId?.href,
          recipient,
          receivedAt: new Date().toISOString(),
          raw,
        }
        addInboxActivity(state, recipient, stored)
        console.log(`[inbox] Accept stored for ${recipient}`)
      } catch (err) {
        console.error('[inbox] Accept handler error:', err)
        throw err
      }
    })
    .on(Undo, async (ctx, undo) => {
      const object = await undo.getObject()
      if (!(object instanceof Follow)) {
        console.log('[inbox] Undo: not a Follow')
        return
      }

      const parsed = ctx.parseUri(object.objectId)
      if (!parsed || parsed.type !== 'actor') {
        console.log('[inbox] Undo Follow: could not parse objectId')
        return
      }

      const identifier = parsed.identifier
      const actor = await undo.getActor()
      if (!actor?.id) {
        console.log('[inbox] Undo Follow: could not get actor')
        return
      }

      console.log(
        `[inbox] Undo Follow: ${actor.id.href} unfollowed ${identifier}`,
      )

      // Remove follower
      removeFollower(state, identifier, actor.id.href)

      // Record the activity
      const stored: StoredActivity = {
        id: `activity-${nextActivityId(state)}`,
        type: 'Undo',
        actor: actor.id.href,
        object: await object.toJsonLd(),
        recipient: identifier,
        receivedAt: new Date().toISOString(),
        raw: await undo.toJsonLd(),
      }
      addInboxActivity(state, identifier, stored)
    })
    .on(Create, async (ctx, create) => {
      const actor = await create.getActor()
      const object = await create.getObject()

      console.log(`[inbox] Create: from ${actor?.id?.href}`)

      // Find recipient from addressing
      let recipient = 'shared'
      const to = create.toIds
      for (const toId of to) {
        const parsed = ctx.parseUri(toId)
        if (
          parsed?.type === 'actor' &&
          config.users.includes(parsed.identifier)
        ) {
          recipient = parsed.identifier
          break
        }
      }

      const stored: StoredActivity = {
        id: `activity-${nextActivityId(state)}`,
        type: 'Create',
        actor: actor?.id?.href || 'unknown',
        object: object instanceof Note ? await object.toJsonLd() : object,
        recipient,
        receivedAt: new Date().toISOString(),
        raw: await create.toJsonLd(),
      }
      addInboxActivity(state, recipient, stored)
    })
    .on(Delete, async (ctx, del) => {
      const actor = await del.getActor()

      console.log(`[inbox] Delete: from ${actor?.id?.href}`)

      // Find recipient from addressing
      let recipient = 'shared'
      const to = del.toIds
      for (const toId of to) {
        const parsed = ctx.parseUri(toId)
        if (
          parsed?.type === 'actor' &&
          config.users.includes(parsed.identifier)
        ) {
          recipient = parsed.identifier
          break
        }
      }

      const stored: StoredActivity = {
        id: `activity-${nextActivityId(state)}`,
        type: 'Delete',
        actor: actor?.id?.href || 'unknown',
        object: del.objectId?.href,
        recipient,
        receivedAt: new Date().toISOString(),
        raw: await del.toJsonLd(),
      }
      addInboxActivity(state, recipient, stored)
    })

  // Setup outbox dispatcher (read-only for now)
  federation.setOutboxDispatcher('/users/{identifier}/outbox', async () => {
    return { items: [] }
  })

  // Setup followers dispatcher
  federation.setFollowersDispatcher(
    '/users/{identifier}/followers',
    async (_ctx, _identifier) => {
      return { items: [] }
    },
  )

  // Setup following dispatcher
  federation.setFollowingDispatcher(
    '/users/{identifier}/following',
    async (_ctx, _identifier) => {
      return { items: [] }
    },
  )

  return { federation, kv }
}
