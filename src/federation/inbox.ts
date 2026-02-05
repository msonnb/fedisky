import { AtUri } from '@atproto/syntax'
import { Accept, Create, Follow, Note, Undo } from '@fedify/vocab'
import escapeHtml from 'escape-html'
import { AppContext } from '../context'
import { postConverter } from '../conversion'
import { getWideEvent } from '../logging'

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
      // Use the mastodon bridge account as the instance actor for signing shared inbox fetches
      const bridgeDid = ctx.mastodonBridgeAccount.did
      if (!ctx.mastodonBridgeAccount.isAvailable() || bridgeDid === null) {
        return null
      }
      return { identifier: bridgeDid }
    })
    .on(Follow, async (fedCtx, follow) => {
      const event = getWideEvent()
      event?.set('activity.type', 'Follow')
      event?.set('activity.id', follow.id?.href)

      try {
        if (
          follow.id === null ||
          follow.actorId === null ||
          follow.objectId === null
        ) {
          event?.set('activity.ignored_reason', 'missing_required_fields')
          return
        }

        event?.set('activity.actor_id', follow.actorId.href)

        const parsed = fedCtx.parseUri(follow.objectId)
        if (parsed?.type !== 'actor') {
          event?.set('activity.ignored_reason', 'object_not_actor')
          return
        }

        event?.set('user.did', parsed.identifier)

        const follower = await follow.getActor()
        if (follower === null) {
          event?.set('activity.ignored_reason', 'could_not_fetch_actor')
          return
        }

        event?.set('activity.follower_uri', (follower.id as URL).href)

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
        event?.set('activity.accepted', true)
      } catch (err) {
        event?.setError(err instanceof Error ? err : new Error(String(err)))
      }
    })
    .on(Undo, async (fedCtx, undo) => {
      const event = getWideEvent()
      event?.set('activity.type', 'Undo')
      event?.set('activity.id', undo.id?.href)

      try {
        const object = await undo.getObject()
        if (!(object instanceof Follow)) {
          event?.set('activity.ignored_reason', 'not_a_follow')
          return
        }

        event?.set('activity.inner_type', 'Follow')

        if (undo.actorId == null || object.objectId == null) {
          event?.set('activity.ignored_reason', 'missing_actor_or_object')
          return
        }

        event?.set('activity.actor_id', undo.actorId.href)

        const parsed = fedCtx.parseUri(object.objectId)
        if (parsed == null || parsed.type !== 'actor') {
          event?.set('activity.ignored_reason', 'object_not_actor')
          return
        }

        event?.set('user.did', parsed.identifier)

        await ctx.db.deleteFollow(parsed.identifier, (undo.actorId as URL).href)
        event?.set('activity.unfollow_processed', true)
      } catch (err) {
        event?.setError(err instanceof Error ? err : new Error(String(err)))
      }
    })
    .on(Create, async (fedCtx, create) => {
      const event = getWideEvent()
      event?.set('activity.type', 'Create')
      event?.set('activity.id', create.id?.href)

      try {
        if (!ctx.mastodonBridgeAccount.isAvailable()) {
          event?.set('activity.ignored_reason', 'bridge_not_configured')
          return
        }

        const object = await create.getObject()
        if (!(object instanceof Note)) {
          event?.set('activity.ignored_reason', 'not_a_note')
          return
        }

        event?.set('activity.object_type', 'Note')
        event?.set('activity.note_id', object.id?.href)

        const replyTargetId = object.replyTargetId
        if (!replyTargetId) {
          event?.set('activity.ignored_reason', 'not_a_reply')
          return
        }

        event?.set('activity.reply_target', replyTargetId.href)

        const parsed = fedCtx.parseUri(replyTargetId)
        if (!parsed || parsed.type !== 'object') {
          event?.set('activity.ignored_reason', 'reply_target_not_local')
          return
        }

        // Extract the identifier (DID) from the reply target
        const urlPath = replyTargetId.pathname
        const postUri = urlPath.slice(
          urlPath.indexOf('posts/') + 'posts/'.length,
        )
        const postAtUri = new AtUri(postUri)
        const postAuthorDid = postAtUri.host
        event?.set('user.did', postAuthorDid)

        const account = await ctx.pdsClient.getAccount(postAuthorDid)
        if (!account) {
          event?.set('activity.ignored_reason', 'user_not_found')
          return
        }

        const actor = await create.getActor()
        if (!actor) {
          event?.set('activity.ignored_reason', 'could_not_fetch_actor')
          return
        }

        const actorId = actor.id
        event?.set('activity.actor_id', actorId?.href)

        const actorUsername = actor.preferredUsername?.toString() ?? 'unknown'
        let actorHandle = actorUsername
        let actorProfileUrl: string | undefined
        if (actorId) {
          actorHandle = `@${actorUsername}@${actorId.hostname}`
          actorProfileUrl = `${actorId.origin}/@${actorUsername}`
        }

        event?.set('activity.actor_handle', actorHandle)

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
              ctx.mastodonBridgeAccount.uploadBlob(data, mimeType),
          },
        )

        if (!convertedRecord) {
          event?.set('activity.ignored_reason', 'conversion_failed')
          return
        }

        const postRecord = convertedRecord.value

        const parentRecord = await ctx.pdsClient.getRecord(
          postAuthorDid,
          'app.bsky.feed.post',
          postAtUri.rkey,
        )

        if (!parentRecord) {
          event?.set('activity.ignored_reason', 'parent_not_found')
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

        const result = await ctx.mastodonBridgeAccount.createRecord(
          'app.bsky.feed.post',
          postRecord,
        )

        event?.set('activity.created_post_uri', result.uri)

        const actorInboxId = actor.inboxId
        if (object.id && actorId && actorInboxId) {
          await ctx.db.createPostMapping({
            atUri: result.uri,
            apNoteId: object.id.href,
            apActorId: actorId.href,
            apActorInbox: actorInboxId.href,
            createdAt: new Date().toISOString(),
          })
          event?.set('activity.post_mapping_created', true)
        }

        event?.set('activity.bridge_post_created', true)
      } catch (err) {
        event?.setError(err instanceof Error ? err : new Error(String(err)))
      }
    })
}
