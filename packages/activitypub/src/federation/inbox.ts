import { Accept, Create, Follow, Note, Undo } from '@fedify/fedify'
import { AtUri } from '@atproto/syntax'
import { AppContext } from '../context'
import { apLogger } from '../logger'
import { postConverter } from '../conversion'

export function setupInboxListeners(ctx: AppContext) {
  ctx.federation
    .setInboxListeners('/users/{+identifier}/inbox', '/inbox')
    .on(Follow, async (fedCtx, follow) => {
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
        const parsed = fedCtx.parseUri(follow.objectId)
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

        await ctx.db.createFollow({
          userDid: parsed.identifier,
          activityId: (follow.id as URL).href,
          actorUri: (follower.id as URL).href,
          actorInbox: (follower.inboxId as URL).href,
          createdAt: new Date().toISOString(),
        })

        await fedCtx.sendActivity(
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
        apLogger.warn(
          { err, followId: follow.id?.href, actorId: follow.actorId?.href },
          'failed to process follow activity',
        )
      }
    })
    .on(Undo, async (fedCtx, undo) => {
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
        const parsed = fedCtx.parseUri(object.objectId)
        if (parsed == null || parsed.type !== 'actor') {
          apLogger.debug(
            { objectId: object.objectId.href },
            'ignoring undo: object is not an actor',
          )
          return
        }
        await ctx.db.deleteFollow(parsed.identifier, (undo.actorId as URL).href)
        apLogger.info(
          {
            identifier: parsed.identifier,
            actorUri: (undo.actorId as URL).href,
          },
          'processed unfollow',
        )
      } catch (err) {
        apLogger.warn(
          { err, undoId: undo.id?.href, actorId: undo.actorId?.href },
          'failed to process undo activity',
        )
      }
    })
    .on(Create, async (fedCtx, create) => {
      try {
        if (!ctx.bridgeAccount.isAvailable()) {
          apLogger.warn(
            { createId: create.id?.href },
            'skipping incoming create: bridge account not configured',
          )
          return
        }

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

        const parsed = fedCtx.parseUri(replyTargetId)
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
        const account = await ctx.pdsClient.getAccount(postAuthorDid)
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
          fedCtx,
          postAuthorDid,
          modifiedNote,
          {
            pdsClient: ctx.pdsClient,
            uploadBlob: (data, mimeType) =>
              ctx.bridgeAccount.uploadBlob(data, mimeType),
          },
        )

        if (!convertedRecord) {
          apLogger.warn(
            { noteId: object.id?.href },
            'failed to convert Note to record',
          )
          return
        }

        const postRecord = convertedRecord.value as {
          text: string
          createdAt: string
          reply?: {
            root: { uri: string; cid: string }
            parent: { uri: string; cid: string }
          }
        }

        const parentRecord = await ctx.pdsClient.getRecord(
          postAuthorDid,
          'app.bsky.feed.post',
          postAtUri.rkey,
        )

        if (!parentRecord) {
          apLogger.warn(
            { postAtUri: postAtUri.toString() },
            'could not find parent post for reply',
          )
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

        const result = await ctx.bridgeAccount.createRecord(
          'app.bsky.feed.post',
          postRecord,
        )

        apLogger.info(
          {
            bridgeAccountDid: ctx.bridgeAccount.did,
            postAuthorDid,
            actorHandle,
            noteId: object.id?.href,
            postUri: result.uri,
          },
          'created reply post from ActivityPub via bridge account',
        )
      } catch (err) {
        apLogger.warn(
          { err, createId: create.id?.href },
          'failed to process create activity',
        )
      }
    })
}
