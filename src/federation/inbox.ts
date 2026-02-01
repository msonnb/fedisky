import { AtUri } from '@atproto/syntax'
import { Accept, Create, Follow, Note, Undo } from '@fedify/fedify'
import escapeHtml from 'escape-html'
import { AppContext } from '../context'
import { postConverter } from '../conversion'
import { apLogger } from '../logger'

/**
 * Validate URL scheme (reject javascript:, data:, etc.)
 */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export function setupInboxListeners(ctx: AppContext) {
  ctx.federation
    .setInboxListeners('/users/{+identifier}/inbox', '/inbox')
    .setSharedKeyDispatcher(async () => {
      // Use the bridge account as the instance actor for signing shared inbox fetches
      const bridgeDid = ctx.bridgeAccount.did
      if (!ctx.bridgeAccount.isAvailable() || bridgeDid === null) {
        return null
      }
      return { identifier: bridgeDid }
    })
    .on(Follow, async (fedCtx, follow) => {
      try {
        if (
          follow.id === null ||
          follow.actorId === null ||
          follow.objectId === null
        ) {
          apLogger.debug(
            'ignoring follow: missing required fields {followId}',
            {
              followId: follow.id?.href,
            },
          )
          return
        }
        const parsed = fedCtx.parseUri(follow.objectId)
        if (parsed?.type !== 'actor') {
          apLogger.debug('ignoring follow: object is not an actor {objectId}', {
            objectId: follow.objectId.href,
          })
          return
        }

        const follower = await follow.getActor()

        if (follower === null) {
          apLogger.warn(
            'ignoring follow: could not fetch follower actor {actorId}',
            {
              actorId: follow.actorId.href,
            },
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
        apLogger.info('accepted follow request: {identifier} {followerUri}', {
          identifier: parsed.identifier,
          followerUri: (follower.id as URL).href,
        })
      } catch (err) {
        apLogger.warn(
          'failed to process follow activity: {followId} {actorId} {err}',
          { err, followId: follow.id?.href, actorId: follow.actorId?.href },
        )
      }
    })
    .on(Undo, async (fedCtx, undo) => {
      try {
        const object = await undo.getObject()
        if (!(object instanceof Follow)) {
          apLogger.debug('ignoring undo: not a follow {undoId}', {
            undoId: undo.id?.href,
          })
          return
        }
        if (undo.actorId == null || object.objectId == null) {
          apLogger.debug('ignoring undo: missing actor or object id {undoId}', {
            undoId: undo.id?.href,
          })
          return
        }
        const parsed = fedCtx.parseUri(object.objectId)
        if (parsed == null || parsed.type !== 'actor') {
          apLogger.debug('ignoring undo: object is not an actor {objectId}', {
            objectId: object.objectId.href,
          })
          return
        }
        await ctx.db.deleteFollow(parsed.identifier, (undo.actorId as URL).href)
        apLogger.info('processed unfollow: {identifier} {actorUri}', {
          identifier: parsed.identifier,
          actorUri: (undo.actorId as URL).href,
        })
      } catch (err) {
        apLogger.warn(
          'failed to process undo activity: {undoId} {actorId} {err}',
          {
            err,
            undoId: undo.id?.href,
            actorId: undo.actorId?.href,
          },
        )
      }
    })
    .on(Create, async (fedCtx, create) => {
      try {
        if (!ctx.bridgeAccount.isAvailable()) {
          apLogger.warn(
            'skipping incoming create: bridge account not configured {createId}',
            {
              createId: create.id?.href,
            },
          )
          return
        }

        const object = await create.getObject()
        if (!(object instanceof Note)) {
          apLogger.debug('ignoring create: object is not a Note {createId}', {
            createId: create.id?.href,
          })
          return
        }

        const replyTargetId = object.replyTargetId
        if (!replyTargetId) {
          apLogger.debug('ignoring create: not a reply {noteId}', {
            noteId: object.id?.href,
          })
          return
        }

        const parsed = fedCtx.parseUri(replyTargetId)
        if (!parsed || parsed.type !== 'object') {
          apLogger.debug(
            'ignoring create: reply target is not a local object {replyTargetId}',
            {
              replyTargetId: replyTargetId.href,
            },
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
            'ignoring create: reply target user not found {postAuthorDid}',
            {
              postAuthorDid,
            },
          )
          return
        }

        const actor = await create.getActor()
        if (!actor) {
          apLogger.warn('ignoring create: could not fetch actor {createId}', {
            createId: create.id?.href,
          })
          return
        }

        const actorId = actor.id
        const actorUsername = actor.preferredUsername?.toString() ?? 'unknown'
        let actorHandle = actorUsername
        let actorProfileUrl: string | undefined
        if (actorId) {
          actorHandle = `@${actorUsername}@${actorId.hostname}`
          actorProfileUrl = `${actorId.origin}/@${actorUsername}`
        }

        // Build attribution prefix as HTML with a link to the author's profile
        const originalContent = object.content ?? ''
        const safeHandle = escapeHtml(actorHandle)
        const actorLink =
          actorProfileUrl && isSafeUrl(actorProfileUrl)
            ? `<a href="${escapeHtml(actorProfileUrl)}">${safeHandle}</a>`
            : safeHandle
        const replyPrefixHtml = `<p>${actorLink} replied:</p>`
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
          apLogger.warn('failed to convert Note to record {noteId}', {
            noteId: object.id?.href,
          })
          return
        }

        const postRecord = convertedRecord.value

        const parentRecord = await ctx.pdsClient.getRecord(
          postAuthorDid,
          'app.bsky.feed.post',
          postAtUri.rkey,
        )

        if (!parentRecord) {
          apLogger.warn('could not find parent post for reply {postAtUri}', {
            postAtUri: postAtUri.toString(),
          })
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

        const actorInboxId = actor.inboxId
        if (object.id && actorId && actorInboxId) {
          await ctx.db.createPostMapping({
            atUri: result.uri,
            apNoteId: object.id.href,
            apActorId: actorId.href,
            apActorInbox: actorInboxId.href,
            createdAt: new Date().toISOString(),
          })
          apLogger.debug(
            'stored post mapping for bridge post: {atUri} {apNoteId} {apActorId}',
            {
              atUri: result.uri,
              apNoteId: object.id.href,
              apActorId: actorId.href,
            },
          )
        }

        apLogger.info(
          'created reply post from ActivityPub via bridge account: {bridgeAccountDid} {postAuthorDid} {actorHandle} {noteId} {postUri}',
          {
            bridgeAccountDid: ctx.bridgeAccount.did,
            postAuthorDid,
            actorHandle,
            noteId: object.id?.href,
            postUri: result.uri,
          },
        )
      } catch (err) {
        apLogger.warn('failed to process create activity: {createId} {err}', {
          err,
          createId: create.id?.href,
        })
      }
    })
}
