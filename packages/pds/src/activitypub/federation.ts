import {
  Accept,
  Create,
  exportJwk,
  Follow,
  generateCryptoKeyPair,
  Image,
  importJwk,
  Note,
  parseSemVer,
  Person,
  Undo,
} from '@fedify/fedify'
import { AppContext } from '../context'
import { integrateFederation } from '@fedify/express'
import { Temporal } from '@js-temporal/polyfill'
import { AtUri } from '@atproto/syntax'
import { BlobRef } from '@atproto/lexicon'
import { RecordConverterRegistry, postConverter } from './conversion'
import { apLogger } from '../logger'

export const recordConverterRegistry = new RecordConverterRegistry()
recordConverterRegistry.register(postConverter)

export const createRouter = (appCtx: AppContext) => {
  appCtx.federation.setNodeInfoDispatcher('/nodeinfo/2.1', async (ctx) => {
    try {
      const accountCount = await appCtx.accountManager.getAccountCount()

      return {
        software: {
          name: 'bluesky-pds',
          homepage: new URL('https://bsky.app'),
          repository: new URL('https://github.com/msonnb/atproto'),
          version: parseSemVer(appCtx.cfg.service.version ?? '0.0.0'),
        },
        protocols: ['activitypub'],
        usage: {
          users: { total: accountCount },
          localPosts: 0,
          localComments: 0,
        },
      }
    } catch (err) {
      apLogger.error({ err }, 'failed to dispatch nodeinfo')
      throw err
    }
  })

  appCtx.federation
    .setActorDispatcher(`/users/{+identifier}`, async (ctx, identifier) => {
      try {
        if (identifier.includes('/')) {
          apLogger.debug({ identifier }, 'invalid actor identifier contains /')
          return null
        }

        const account = await appCtx.accountManager.getAccount(identifier)
        if (!account || !account.handle) {
          apLogger.debug({ identifier }, 'actor not found or missing handle')
          return null
        }

        const profile = await appCtx.actorStore.read(
          identifier,
          async (store) => {
            const localViewer = appCtx.localViewer(store)
            const profile = await store.record.getProfileRecord()

            const buildImage = (type: 'avatar' | 'banner', blob?: BlobRef) => {
              if (!blob) return undefined
              const url = localViewer.getImageUrl(type, blob.ref.toString())
              return { url: new URL(url), mediaType: blob.mimeType }
            }

            return {
              ...profile,
              avatar: buildImage('avatar', profile?.avatar),
              banner: buildImage('banner', profile?.banner),
            }
          },
        )

        const keyPairs = await ctx.getActorKeyPairs(identifier)
        apLogger.debug(
          { identifier, handle: account.handle },
          'dispatching actor',
        )
        return new Person({
          id: ctx.getActorUri(identifier),
          name: profile.displayName,
          summary: profile.description,
          preferredUsername: account.handle.split('.').at(0),
          icon: profile.avatar
            ? new Image({
                url: profile.avatar.url,
                mediaType: profile.avatar.mediaType,
              })
            : undefined,
          image: profile.banner
            ? new Image({
                url: profile.banner.url,
                mediaType: profile.banner.mediaType,
              })
            : undefined,
          url: new URL(account.handle, 'https://bsky.app/profile/'),
          inbox: ctx.getInboxUri(identifier),
          outbox: ctx.getOutboxUri(identifier),
          followers: ctx.getFollowersUri(identifier),
          following: ctx.getFollowingUri(identifier),
          publicKey: keyPairs[0].cryptographicKey,
          assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
        })
      } catch (err) {
        apLogger.error({ err, identifier }, 'failed to dispatch actor')
        throw err
      }
    })
    .mapHandle(async (ctx, username) => {
      try {
        const hostname = appCtx.cfg.service.hostname
        const handle = `${username}.${hostname === 'localhost' ? 'test' : hostname}`
        const account = await appCtx.accountManager.getAccount(handle)
        if (!account) {
          apLogger.debug(
            { username, handle },
            'handle mapping failed: account not found',
          )
          return null
        }
        apLogger.debug(
          { username, handle, did: account.did },
          'mapped handle to did',
        )
        return account.did
      } catch (err) {
        apLogger.error({ err, username }, 'failed to map handle')
        throw err
      }
    })
    .setKeyPairsDispatcher(async (ctx, identifier) => {
      try {
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
          apLogger.info({ identifier }, 'generating new RSA keypair')
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
          apLogger.info({ identifier }, 'generating new Ed25519 keypair')
          const { publicKey, privateKey } =
            await generateCryptoKeyPair('Ed25519')
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
              publicKey: await importJwk(
                JSON.parse(keypair.publicKey),
                'public',
              ),
            }
          }),
        )

        apLogger.debug({ identifier }, 'dispatched keypairs')
        return pairs
      } catch (err) {
        apLogger.error({ err, identifier }, 'failed to dispatch keypairs')
        throw err
      }
    })

  appCtx.federation
    .setFollowersDispatcher(
      '/users/{+identifier}/followers',
      async (ctx, identifier, cursor) => {
        try {
          const { follows, nextCursor } = await appCtx.actorStore.read(
            identifier,
            async (store) => {
              return store.activityPub.follow.getFollows({ cursor, limit: 50 })
            },
          )

          apLogger.debug(
            { identifier, followersCount: follows.length, cursor },
            'dispatching followers',
          )
          return {
            items: follows.map((follow) => ({
              id: new URL(follow.actorUri),
              inboxId: new URL(follow.actorInbox),
            })),
            nextCursor,
          }
        } catch (err) {
          apLogger.error(
            { err, identifier, cursor },
            'failed to dispatch followers',
          )
          throw err
        }
      },
    )
    .setCounter(async (ctx, identifier) => {
      try {
        return await appCtx.actorStore.read(identifier, async (store) => {
          return store.activityPub.follow.getFollowsCount()
        })
      } catch (err) {
        apLogger.error({ err, identifier }, 'failed to count followers')
        throw err
      }
    })
    .setFirstCursor(() =>
      Temporal.Now.zonedDateTimeISO('UTC').add({ days: 1 }).toString(),
    )

  appCtx.federation
    .setFollowingDispatcher(
      '/users/{+identifier}/following',
      async (ctx, identifier, cursor) => {
        try {
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
            .filter((record) =>
              localAccounts.has(record.value.subject as string),
            )
            .map((record) => ctx.getActorUri(record.value.subject as string))

          apLogger.debug(
            { identifier, followingCount: items.length, cursor },
            'dispatching following',
          )
          return {
            items,
            nextCursor,
          }
        } catch (err) {
          apLogger.error(
            { err, identifier, cursor },
            'failed to dispatch following',
          )
          throw err
        }
      },
    )
    .setCounter(async (ctx, identifier) => {
      try {
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
      } catch (err) {
        apLogger.error({ err, identifier }, 'failed to count following')
        throw err
      }
    })
    .setFirstCursor(() => '')

  appCtx.federation
    .setInboxListeners('/users/{+identifier}/inbox', '/inbox')
    .on(Follow, async (ctx, follow) => {
      try {
        if (
          follow.id === null ||
          follow.actorId === null ||
          follow.objectId === null
        ) {
          apLogger.debug(
            { followId: follow.id?.href },
            'ignoring follow: missing required fields',
          )
          return
        }
        const parsed = ctx.parseUri(follow.objectId)
        if (parsed?.type !== 'actor') {
          apLogger.debug(
            { objectId: follow.objectId.href },
            'ignoring follow: object is not an actor',
          )
          return
        }

        const follower = await follow.getActor()

        if (follower === null) {
          apLogger.warn(
            { actorId: follow.actorId.href },
            'ignoring follow: could not fetch follower actor',
          )
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
        apLogger.info(
          {
            identifier: parsed.identifier,
            followerUri: (follower.id as URL).href,
          },
          'accepted follow request',
        )
      } catch (err) {
        apLogger.error(
          { err, followId: follow.id?.href, actorId: follow.actorId?.href },
          'failed to process follow activity',
        )
        throw err
      }
    })
    .on(Undo, async (ctx, undo) => {
      try {
        const object = await undo.getObject()
        if (!(object instanceof Follow)) {
          apLogger.debug(
            { undoId: undo.id?.href },
            'ignoring undo: not a follow',
          )
          return
        }
        if (undo.actorId == null || object.objectId == null) {
          apLogger.debug(
            { undoId: undo.id?.href },
            'ignoring undo: missing actor or object id',
          )
          return
        }
        const parsed = ctx.parseUri(object.objectId)
        if (parsed == null || parsed.type !== 'actor') {
          apLogger.debug(
            { objectId: object.objectId.href },
            'ignoring undo: object is not an actor',
          )
          return
        }
        await appCtx.actorStore.transact(parsed.identifier, async (store) => {
          return store.activityPub.follow.deleteFollow(
            (undo.actorId as URL).href,
          )
        })
        apLogger.info(
          {
            identifier: parsed.identifier,
            actorUri: (undo.actorId as URL).href,
          },
          'processed unfollow',
        )
      } catch (err) {
        apLogger.error(
          { err, undoId: undo.id?.href, actorId: undo.actorId?.href },
          'failed to process undo activity',
        )
        throw err
      }
    })
    .on(Create, async (ctx, create) => {
      try {
        const object = await create.getObject()
        if (!(object instanceof Note)) {
          apLogger.debug(
            { createId: create.id?.href },
            'ignoring create: object is not a Note',
          )
          return
        }

        const replyTargetId = object.replyTargetId
        if (!replyTargetId) {
          apLogger.debug(
            { noteId: object.id?.href },
            'ignoring create: not a reply',
          )
          return
        }

        const parsed = ctx.parseUri(replyTargetId)
        if (!parsed || parsed.type !== 'object') {
          apLogger.debug(
            { replyTargetId: replyTargetId.href },
            'ignoring create: reply target is not a local object',
          )
          return
        }

        // Extract the identifier (DID) from the reply target
        // The reply target URL should be like /posts/at://did:plc:xxx/app.bsky.feed.post/rkey
        const urlPath = replyTargetId.pathname
        const postUri = urlPath.slice(
          urlPath.indexOf('posts/') + 'posts/'.length,
        )
        const postAtUri = new AtUri(postUri)
        const postAuthorDid = postAtUri.host
        const account = await appCtx.accountManager.getAccount(postAuthorDid)
        if (!account) {
          apLogger.debug(
            { postAuthorDid },
            'ignoring create: reply target user not found',
          )
          return
        }

        const actor = await create.getActor()
        if (!actor) {
          apLogger.warn(
            { createId: create.id?.href },
            'ignoring create: could not fetch actor',
          )
          return
        }

        const actorId = actor.id
        let actorHandle = actor.preferredUsername?.toString() ?? 'unknown'
        if (actorId) {
          actorHandle = `@${actorHandle}@${actorId.hostname}`
        }

        const originalContent = object.content ?? ''
        const replyPrefixHtml = `<p>${actorHandle} replied:</p>`
        const modifiedNote = new Note({
          id: object.id,
          content: replyPrefixHtml + originalContent,
          replyTarget: object.replyTargetId,
          published: object.published,
        })

        const convertedRecord = await postConverter.toRecord(
          ctx,
          postAuthorDid,
          modifiedNote,
        )

        if (!convertedRecord) {
          apLogger.warn(
            { noteId: object.id?.href },
            'failed to convert Note to record',
          )
          return
        }

        const postRecord = convertedRecord.value

        const parentRecord = await appCtx.actorStore.read(
          postAuthorDid,
          async (store) => {
            return store.record.getRecord(postAtUri, null)
          },
        )

        if (!parentRecord) {
          apLogger.warn({ postAtUri }, 'could not find parent post for reply')
          return
        }

        const parentRef = {
          uri: postAtUri.toString(),
          cid: parentRecord.cid,
        }

        const parentValue = parentRecord.value as {
          reply?: { root: { uri: string; cid: string } }
        }
        const rootRef = parentValue.reply?.root ?? parentRef

        postRecord.reply = {
          root: rootRef,
          parent: parentRef,
        }

        // Create the post in the user's repo
        const { prepareCreate } = await import('../repo')

        const write = await prepareCreate({
          did: postAuthorDid,
          collection: 'app.bsky.feed.post',
          record: postRecord,
          validate: true,
        })

        const commit = await appCtx.actorStore.transact(
          postAuthorDid,
          async (actorTxn) => {
            const commit = await actorTxn.repo.processWrites([write])
            await appCtx.sequencer.sequenceCommit(postAuthorDid, commit)
            return commit
          },
        )

        await appCtx.accountManager.updateRepoRoot(
          postAuthorDid,
          commit.cid,
          commit.rev,
        )

        apLogger.info(
          {
            postAuthorDid,
            actorHandle,
            noteId: object.id?.href,
            postUri: write.uri.toString(),
          },
          'created reply post from ActivityPub',
        )
      } catch (err) {
        apLogger.error(
          { err, createId: create.id?.href },
          'failed to process create activity',
        )
        throw err
      }
    })

  appCtx.federation
    .setOutboxDispatcher(
      '/users/{+identifier}/outbox',
      async (ctx, identifier, cursor) => {
        try {
          const limit = 50
          const { records, localViewer } = await appCtx.actorStore.read(
            identifier,
            async (store) => {
              const localViewer = appCtx.localViewer(store)
              const records = await store.record.listRecordsForCollections({
                collections: recordConverterRegistry
                  .getAll()
                  .map((converter) => converter.collection),
                limit: limit + 1,
                reverse: true,
                cursor: cursor ?? undefined,
              })
              return { records, localViewer }
            },
          )

          let nextCursor: string | null = null
          if (records.length > limit) {
            records.pop()
            const lastPost = records[records.length - 1]
            nextCursor = new AtUri(lastPost.uri).rkey
          }

          const items = await Promise.all(
            records.map(async (record) => {
              try {
                const atUri = new AtUri(record.uri)
                const recordConverter = recordConverterRegistry.get(
                  atUri.collection,
                )
                if (!recordConverter) {
                  apLogger.debug(
                    { collection: atUri.collection },
                    'no converter found for collection',
                  )
                  return null
                }

                const conversionResult = await recordConverter.toActivityPub(
                  ctx,
                  identifier,
                  record,
                  localViewer,
                )

                if (!conversionResult || !conversionResult.activity) {
                  return null
                }

                return conversionResult.activity
              } catch (err) {
                apLogger.warn(
                  { err, uri: record.uri },
                  'failed to convert record to activity',
                )
                return null
              }
            }),
          )

          apLogger.debug(
            { identifier, itemCount: items.filter(Boolean).length, cursor },
            'dispatching outbox',
          )
          return {
            items: items.filter((item) => item !== null),
            nextCursor,
          }
        } catch (err) {
          apLogger.error(
            { err, identifier, cursor },
            'failed to dispatch outbox',
          )
          throw err
        }
      },
    )
    .setCounter(async (ctx, identifier) => {
      try {
        const records = await appCtx.actorStore.read(
          identifier,
          async (store) =>
            await store.record.listRecordsForCollections({
              collections: recordConverterRegistry
                .getAll()
                .map((converter) => converter.collection),
              limit: 10000,
              reverse: true,
            }),
        )
        return records.length
      } catch (err) {
        apLogger.error({ err, identifier }, 'failed to count outbox items')
        throw err
      }
    })
    .setFirstCursor(() => '')

  appCtx.federation.setObjectDispatcher(
    Note,
    '/posts/{+uri}',
    async (ctx, values) => {
      try {
        const atUri = new AtUri(values.uri)
        const identifier = atUri.hostname
        const recordConverter = recordConverterRegistry.get(atUri.collection)

        if (!recordConverter) {
          apLogger.debug(
            { uri: values.uri, collection: atUri.collection },
            'no converter found for object',
          )
          return null
        }

        const result = await appCtx.actorStore.read(
          identifier,
          async (store) => {
            const localViewer = appCtx.localViewer(store)
            const record = await store.record.getRecord(atUri, null)
            return { record, localViewer }
          },
        )

        if (!result.record) {
          apLogger.debug({ uri: values.uri }, 'record not found for object')
          return null
        }

        const conversionResult = await recordConverter.toActivityPub(
          ctx,
          identifier,
          result.record,
          result.localViewer,
        )

        if (!conversionResult) {
          apLogger.debug({ uri: values.uri }, 'conversion failed for object')
          return null
        }

        apLogger.debug({ uri: values.uri }, 'dispatching object')
        return conversionResult.object
      } catch (err) {
        apLogger.error({ err, uri: values.uri }, 'failed to dispatch object')
        throw err
      }
    },
  )

  return integrateFederation(appCtx.federation, () => {})
}
