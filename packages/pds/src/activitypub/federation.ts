import {
  Accept,
  createFederation,
  exportJwk,
  Follow,
  generateCryptoKeyPair,
  importJwk,
  MemoryKvStore,
  Note,
  parseSemVer,
  Person,
  Undo,
} from '@fedify/fedify'
import { AppContext } from '../context'
import { integrateFederation } from '@fedify/express'
import { Temporal } from '@js-temporal/polyfill'
import { AtUri } from '@atproto/syntax'
import { buildCreateNoteActivity, buildNote } from './note'

export const createRouter = (appCtx: AppContext) => {
  appCtx.federation.setNodeInfoDispatcher('/nodeinfo/2.1', async (ctx) => {
    return {
      software: {
        name: 'bluesky-pds',
        homepage: new URL('https://bsky.app'),
        repository: new URL('https://github.com/msonnb/atproto'),
        version: parseSemVer(appCtx.cfg.service.version ?? '0.0.0'),
      },
      protocols: ['activitypub'],
      usage: {
        users: { total: 1 },
        localPosts: 0,
        localComments: 0,
      },
    }
  })

  appCtx.federation
    .setActorDispatcher(`/users/{+identifier}`, async (ctx, identifier) => {
      if (identifier.includes('/')) {
        return null
      }

      const account = await appCtx.accountManager.getAccount(identifier)
      if (!account) {
        return null
      }

      const profile = await appCtx.actorStore.read(
        identifier,
        async (store) => {
          return store.record.getProfileRecord()
        },
      )

      if (!profile) {
        return null
      }

      const actorUri = ctx.getActorUri(identifier)

      console.log(profile)
      console.log(actorUri.host)
      console.log(appCtx.cfg.identity.serviceHandleDomains)

      if (!account.handle) {
        return null
      }

      // if (!supportedActor) {
      //   return null
      // }
      const keyPairs = await ctx.getActorKeyPairs(identifier)
      return new Person({
        id: ctx.getActorUri(identifier),
        name: profile.displayName,
        summary: profile.description,
        preferredUsername: account.handle.split('.').at(0),
        url: new URL(account.handle, 'https://bsky.app/profile/'),
        inbox: ctx.getInboxUri(identifier),
        outbox: ctx.getOutboxUri(identifier),
        followers: ctx.getFollowersUri(identifier),
        following: ctx.getFollowingUri(identifier),
        publicKey: keyPairs[0].cryptographicKey,
        assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
      })
    })
    .mapHandle(async (ctx, username) => {
      const hostname = appCtx.cfg.service.hostname
      const handle = `${username}.${hostname === 'localhost' ? 'test' : hostname}`
      const account = await appCtx.accountManager.getAccount(handle)
      if (!account) {
        return null
      }
      return account.did
    })
    .setKeyPairsDispatcher(async (ctx, identifier) => {
      let rsaKeypair = await appCtx.actorStore.read(
        identifier,
        async (store) => {
          return store.activityPub.keyPair.getKeypair('RSASSA-PKCS1-v1_5')
        },
      )

      let ed25519Keypair = await appCtx.actorStore.read(
        identifier,
        async (store) => {
          return store.activityPub.keyPair.getKeypair('Ed25519')
        },
      )

      if (!rsaKeypair) {
        const { publicKey, privateKey } =
          await generateCryptoKeyPair('RSASSA-PKCS1-v1_5')
        rsaKeypair = await appCtx.actorStore.transact(
          identifier,
          async (store) => {
            return store.activityPub.keyPair.createKeypair({
              type: 'RSASSA-PKCS1-v1_5',
              publicKey: JSON.stringify(await exportJwk(publicKey)),
              privateKey: JSON.stringify(await exportJwk(privateKey)),
              createdAt: new Date().toISOString(),
            })
          },
        )
      }

      if (!ed25519Keypair) {
        const { publicKey, privateKey } = await generateCryptoKeyPair('Ed25519')
        ed25519Keypair = await appCtx.actorStore.transact(
          identifier,
          async (store) => {
            return store.activityPub.keyPair.createKeypair({
              type: 'Ed25519',
              publicKey: JSON.stringify(await exportJwk(publicKey)),
              privateKey: JSON.stringify(await exportJwk(privateKey)),
              createdAt: new Date().toISOString(),
            })
          },
        )
      }

      const pairs = await Promise.all(
        [rsaKeypair, ed25519Keypair].map(async (keypair) => {
          return {
            privateKey: await importJwk(
              JSON.parse(keypair.privateKey),
              'private',
            ),
            publicKey: await importJwk(JSON.parse(keypair.publicKey), 'public'),
          }
        }),
      )

      return pairs
    })

  appCtx.federation
    .setFollowersDispatcher(
      '/users/{+identifier}/followers',
      async (ctx, identifier, cursor) => {
        const { follows, nextCursor } = await appCtx.actorStore.read(
          identifier,
          async (store) => {
            return store.activityPub.follow.getFollows({ cursor, limit: 50 })
          },
        )

        return {
          items: follows.map((follow) => ({
            id: new URL(follow.actorUri),
            inboxId: new URL(follow.actorInbox),
          })),
          nextCursor,
        }
      },
    )
    .setCounter(async (ctx, identifier) => {
      return await appCtx.actorStore.read(identifier, async (store) => {
        return store.activityPub.follow.getFollowsCount()
      })
    })
    .setFirstCursor(() =>
      Temporal.Now.zonedDateTimeISO('UTC').add({ days: 1 }).toString(),
    )

  appCtx.federation
    .setFollowingDispatcher(
      '/users/{+identifier}/following',
      async (ctx, identifier, cursor) => {
        const limit = 50
        const followRecords = await appCtx.actorStore.read(
          identifier,
          async (store) => {
            return store.record.listRecordsForCollection({
              collection: 'app.bsky.graph.follow',
              limit: limit + 1,
              reverse: true,
              cursor: cursor ?? undefined,
            })
          },
        )

        let nextCursor: string | null = null
        if (followRecords.length > limit) {
          followRecords.pop()
          const lastRecord = followRecords[followRecords.length - 1]
          nextCursor = new AtUri(lastRecord.uri).rkey
        }

        const followedDids = followRecords.map(
          (record) => record.value.subject as string,
        )

        const localAccounts =
          await appCtx.accountManager.getAccounts(followedDids)

        const items = followRecords
          .filter((record) => localAccounts.has(record.value.subject as string))
          .map((record) => ctx.getActorUri(record.value.subject as string))

        return {
          items,
          nextCursor,
        }
      },
    )
    .setCounter(async (ctx, identifier) => {
      const allFollowRecords = await appCtx.actorStore.read(
        identifier,
        async (store) => {
          return store.record.listRecordsForCollection({
            collection: 'app.bsky.graph.follow',
            limit: 10000,
            reverse: true,
          })
        },
      )

      const followedDids = allFollowRecords.map(
        (record) => record.value.subject as string,
      )

      const localAccounts =
        await appCtx.accountManager.getAccounts(followedDids)

      return localAccounts.size
    })
    .setFirstCursor(() => '')

  appCtx.federation
    .setInboxListeners('/users/{+identifier}/inbox', '/inbox')
    .on(Follow, async (ctx, follow) => {
      if (
        follow.id === null ||
        follow.actorId === null ||
        follow.objectId === null
      ) {
        return
      }
      const parsed = ctx.parseUri(follow.objectId)
      if (parsed?.type !== 'actor') {
        return
      }

      const follower = await follow.getActor()

      if (follower === null) {
        return
      }

      await appCtx.actorStore.transact(parsed.identifier, async (store) => {
        return store.activityPub.follow.createFollow({
          activityId: (follow.id as URL).href,
          actorUri: (follower.id as URL).href,
          actorInbox: (follower.inboxId as URL).href,
          createdAt: new Date().toISOString(),
        })
      })
      await ctx.sendActivity(
        { identifier: parsed.identifier },
        follower,
        new Accept({ actor: follow.objectId, object: follow }),
      )
    })
    .on(Undo, async (ctx, undo) => {
      const object = await undo.getObject()
      if (!(object instanceof Follow)) return
      if (undo.actorId == null || object.objectId == null) return
      const parsed = ctx.parseUri(object.objectId)
      if (parsed == null || parsed.type !== 'actor') return
      await appCtx.actorStore.transact(parsed.identifier, async (store) => {
        return store.activityPub.follow.deleteFollow((undo.actorId as URL).href)
      })
    })

  appCtx.federation
    .setOutboxDispatcher(
      '/users/{+identifier}/outbox',
      async (ctx, identifier, cursor) => {
        const limit = 50
        const posts = await appCtx.actorStore.read(
          identifier,
          async (store) => {
            return store.record.listRecordsForCollection({
              collection: appCtx.cfg.activitypub.noteCollection,
              limit: limit + 1,
              reverse: true,
              cursor: cursor ?? undefined,
            })
          },
        )

        let nextCursor: string | null = null
        if (posts.length > limit) {
          posts.pop()
          const lastPost = posts[posts.length - 1]
          nextCursor = new AtUri(lastPost.uri).rkey
        }

        const items = posts.map((post) => {
          const atUri = new AtUri(post.uri)
          return buildCreateNoteActivity(ctx, {
            atUri: post.uri,
            did: identifier,
            text: post.value.text as string,
            rkey: atUri.rkey,
            published: Temporal.Instant.from(post.value.createdAt as string),
          })
        })

        return {
          items,
          nextCursor,
        }
      },
    )
    .setCounter(async (ctx, identifier) => {
      const posts = await appCtx.actorStore.read(identifier, async (store) => {
        return store.record.listRecordsForCollection({
          collection: 'app.bsky.feed.post',
          limit: 10000,
          reverse: true,
        })
      })
      return posts.length
    })
    .setFirstCursor(() => '')

  appCtx.federation.setObjectDispatcher(
    Note,
    '/posts/{+uri}',
    async (ctx, values) => {
      const atUri = new AtUri(values.uri)
      const post = await appCtx.actorStore.read(
        atUri.hostname,
        async (store) => {
          return store.record.getRecord(atUri, null)
        },
      )

      if (!post) {
        return null
      }

      return buildNote(ctx, {
        atUri: values.uri,
        did: atUri.hostname,
        text: post.value.text as string,
        rkey: atUri.rkey,
        published: Temporal.Instant.from(post.value.createdAt as string),
      })
    },
  )

  return integrateFederation(appCtx.federation, () => {})
}
