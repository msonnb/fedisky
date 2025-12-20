import {
  Accept,
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
import {
  buildCreateNoteActivity,
  buildNote,
  type ActivityPubAttachment,
} from './note'
import { BlobRef } from '@atproto/lexicon'
import { LocalViewer } from '../read-after-write/viewer'
import {
  isMain as isEmbedImages,
  type Main as EmbedImages,
} from '../lexicon/types/app/bsky/embed/images'
import {
  isMain as isEmbedVideo,
  type Main as EmbedVideo,
} from '../lexicon/types/app/bsky/embed/video'
import {
  isMain as isEmbedRecordWithMedia,
  type Main as EmbedRecordWithMedia,
} from '../lexicon/types/app/bsky/embed/recordWithMedia'

function buildAttachmentsFromEmbed(
  localViewer: LocalViewer,
  embed: unknown,
): ActivityPubAttachment[] {
  const attachments: ActivityPubAttachment[] = []

  if (!embed) {
    return attachments
  }

  if (isEmbedImages(embed)) {
    const imagesEmbed = embed as EmbedImages
    for (const img of imagesEmbed.images) {
      const blobRef = BlobRef.asBlobRef(img.image)
      if (blobRef) {
        const url = localViewer.getImageUrl(
          'feed_fullsize',
          blobRef.ref.toString(),
        )
        attachments.push({
          url: new URL(url),
          mediaType: blobRef.mimeType,
          name: img.alt || undefined,
        })
      }
    }
  }

  if (isEmbedVideo(embed)) {
    const videoEmbed = embed as EmbedVideo
    const blobRef = BlobRef.asBlobRef(videoEmbed.video)
    if (blobRef) {
      const url = localViewer.getImageUrl(
        'feed_fullsize',
        blobRef.ref.toString(),
      )
      attachments.push({
        url: new URL(url),
        mediaType: blobRef.mimeType,
        name: videoEmbed.alt || undefined,
      })
    }
  }

  if (isEmbedRecordWithMedia(embed)) {
    const recordWithMedia = embed as EmbedRecordWithMedia
    const mediaAttachments = buildAttachmentsFromEmbed(
      localViewer,
      recordWithMedia.media,
    )
    attachments.push(...mediaAttachments)
  }

  return attachments
}

export const createRouter = (appCtx: AppContext) => {
  appCtx.federation.setNodeInfoDispatcher('/nodeinfo/2.1', async (ctx) => {
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
  })

  appCtx.federation
    .setActorDispatcher(`/users/{+identifier}`, async (ctx, identifier) => {
      if (identifier.includes('/')) {
        return null
      }

      const account = await appCtx.accountManager.getAccount(identifier)
      if (!account || !account.handle) {
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
        const { posts, localViewer } = await appCtx.actorStore.read(
          identifier,
          async (store) => {
            const localViewer = appCtx.localViewer(store)
            const posts = await store.record.listRecordsForCollection({
              collection: appCtx.cfg.activitypub.noteCollection,
              limit: limit + 1,
              reverse: true,
              cursor: cursor ?? undefined,
            })
            return { posts, localViewer }
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
          const attachments = buildAttachmentsFromEmbed(
            localViewer,
            post.value.embed,
          )
          return buildCreateNoteActivity(ctx, {
            atUri: post.uri,
            did: identifier,
            text: post.value.text as string,
            rkey: atUri.rkey,
            published: Temporal.Instant.from(post.value.createdAt as string),
            attachments,
            langs: post.value.langs as string[] | undefined,
            labels: post.value.labels as
              | { values?: { val: string }[] }
              | undefined,
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
      const result = await appCtx.actorStore.read(
        atUri.hostname,
        async (store) => {
          const localViewer = appCtx.localViewer(store)
          const post = await store.record.getRecord(atUri, null)
          return { post, localViewer }
        },
      )

      if (!result.post) {
        return null
      }

      const attachments = buildAttachmentsFromEmbed(
        result.localViewer,
        result.post.value.embed,
      )

      return buildNote(ctx, {
        atUri: values.uri,
        did: atUri.hostname,
        text: result.post.value.text as string,
        rkey: atUri.rkey,
        published: Temporal.Instant.from(result.post.value.createdAt as string),
        attachments,
        langs: result.post.value.langs as string[] | undefined,
        labels: result.post.value.labels as
          | { values?: { val: string }[] }
          | undefined,
      })
    },
  )

  return integrateFederation(appCtx.federation, () => {})
}
