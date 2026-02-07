import crypto from 'node:crypto'
import { AtUri } from '@atproto/syntax'
import { Create, Note, PUBLIC_COLLECTION } from '@fedify/vocab'
import { Temporal } from '@js-temporal/polyfill'
import escapeHtml from 'escape-html'
import type { AppContext } from '../context'
import { logger } from '../logger'
import { createWideEvent } from '../logging'
import { ConstellationClient } from './client'

const BATCH_SIZE = 50

/**
 * Background processor that polls Constellation for external Bluesky replies
 * and federates them to ActivityPub.
 */
export class ConstellationProcessor {
  private ctx: AppContext
  private client: ConstellationClient
  private running = false
  private pollTimer?: ReturnType<typeof setTimeout>

  constructor(ctx: AppContext) {
    this.ctx = ctx
    this.client = new ConstellationClient(ctx.cfg.constellation.url)
  }

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true
    logger.info('constellation processor starting', {
      pollInterval: this.ctx.cfg.constellation.pollInterval,
    })

    this.schedulePoll()
  }

  async stop(): Promise<void> {
    logger.info('constellation processor stopping')
    this.running = false

    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  private schedulePoll(): void {
    if (!this.running) return

    this.pollTimer = setTimeout(async () => {
      try {
        await this.poll()
      } catch (err) {
        logger.error('constellation poll failed', { err })
      }
      this.schedulePoll()
    }, this.ctx.cfg.constellation.pollInterval)
  }

  private async poll(): Promise<void> {
    const event = createWideEvent('constellation_poll')

    const posts = await this.ctx.db.getMonitoredPostsBatch(BATCH_SIZE)
    event.set('poll.post_count', posts.length)

    if (posts.length === 0) {
      event.setOutcome('success').emit()
      return
    }

    let checkedCount = 0
    let errorCount = 0

    for (const post of posts) {
      try {
        await this.checkPostForReplies(post.atUri, post.authorDid)
        await this.ctx.db.updateMonitoredPostLastChecked(post.atUri)
        checkedCount++
      } catch {
        errorCount++
      }
    }

    event.set('poll.checked_count', checkedCount)
    if (errorCount > 0) {
      event.set('poll.error_count', errorCount)
    }
    event.setOutcome(errorCount === 0 ? 'success' : 'error')
    event.emit()
  }

  private async checkPostForReplies(
    postAtUri: string,
    postAuthorDid: string,
  ): Promise<void> {
    const { backlinks } = await this.client.getReplies(postAtUri, {
      limit: 100,
    })

    if (backlinks.length === 0) {
      return
    }

    for (const reply of backlinks) {
      await this.processReply(reply.uri, postAtUri, postAuthorDid)
    }
  }

  private async processReply(
    replyAtUri: string,
    parentAtUri: string,
    parentAuthorDid: string,
  ): Promise<void> {
    const event = createWideEvent('constellation_reply')
      .set('reply.uri', replyAtUri)
      .set('reply.parent_uri', parentAtUri)
      .set('reply.parent_author', parentAuthorDid)

    try {
      const existing = await this.ctx.db.getExternalReply(replyAtUri)
      if (existing) {
        event.setOutcome('ignored').set('ignored_reason', 'already_processed')
        event.emit()
        return
      }

      const replyUri = new AtUri(replyAtUri)
      const replyAuthorDid = replyUri.host
      event.set('reply.author_did', replyAuthorDid)

      // Skip if the author is a local PDS user (firehose processor handles those)
      const localAccount = await this.ctx.pdsClient.getAccount(replyAuthorDid)
      if (localAccount) {
        event.setOutcome('ignored').set('ignored_reason', 'local_user')
        event.emit()
        return
      }

      if (
        (this.ctx.mastodonBridgeAccount.isAvailable() &&
          replyAuthorDid === this.ctx.mastodonBridgeAccount.did) ||
        (this.ctx.blueskyBridgeAccount.isAvailable() &&
          replyAuthorDid === this.ctx.blueskyBridgeAccount.did)
      ) {
        event.setOutcome('ignored').set('ignored_reason', 'bridge_account')
        event.emit()
        return
      }

      const record = await this.ctx.appViewClient.getRecord(
        replyAuthorDid,
        'app.bsky.feed.post',
        replyUri.rkey,
      )

      if (!record) {
        event.setOutcome('error').set('error_reason', 'record_not_found')
        event.emit()
        return
      }

      const profile = await this.ctx.appViewClient.getProfile(replyAuthorDid)

      const replyValue = record.value as {
        text?: string
        createdAt?: string
      }

      let authorHandle: string = replyAuthorDid
      if (profile?.handle) {
        authorHandle = `@${profile.handle}`
      } else {
        try {
          const resolvedHandle =
            await this.ctx.appViewClient.resolveHandle(replyAuthorDid)
          if (resolvedHandle) {
            authorHandle = `@${resolvedHandle}`
          }
        } catch {
          // Keep using DID as fallback
        }
      }

      event.set('reply.author_handle', authorHandle)

      const authorProfileUrl = `https://bsky.app/profile/${replyAuthorDid}`
      const authorLink = `<a href="${authorProfileUrl}">${authorHandle}</a>`
      const attributionHtml = `<p>${authorLink} replied:</p>`
      const contentHtml = `<p>${escapeHtml(replyValue.text ?? '')}</p>`

      const fedifyContext = this.ctx.federation.createContext(
        new URL(this.ctx.cfg.service.publicUrl),
      )

      const blueskyBridgeDid = this.ctx.blueskyBridgeAccount.did
      if (!blueskyBridgeDid) {
        event.setOutcome('error').set('error_reason', 'bridge_not_available')
        event.emit()
        return
      }

      const noteId = fedifyContext.getObjectUri(Note, { uri: replyAtUri })
      const parentNoteId = fedifyContext.getObjectUri(Note, {
        uri: parentAtUri,
      })

      const note = new Note({
        id: noteId,
        attribution: fedifyContext.getActorUri(blueskyBridgeDid),
        content: attributionHtml + contentHtml,
        replyTarget: parentNoteId,
        published: replyValue.createdAt
          ? Temporal.Instant.from(replyValue.createdAt)
          : null,
        to: PUBLIC_COLLECTION,
        cc: fedifyContext.getFollowersUri(parentAuthorDid),
      })

      const activity = new Create({
        id: new URL(`#create-${crypto.randomUUID()}`, noteId),
        actor: fedifyContext.getActorUri(blueskyBridgeDid),
        object: note,
        to: PUBLIC_COLLECTION,
        cc: fedifyContext.getFollowersUri(parentAuthorDid),
      })

      event.set('activity.note_id', noteId.href)

      // Send to all followers of the parent post author
      const followers = await this.ctx.db.getFollowers(parentAuthorDid)
      event.set('send.follower_count', followers.length)

      let sentToFollowers = false
      try {
        await fedifyContext.sendActivity(
          { identifier: blueskyBridgeDid },
          followers.map((follower) => ({
            id: new URL(follower.actorUri),
            inboxId: new URL(follower.actorInbox),
          })),
          activity,
        )
        sentToFollowers = true
      } catch (err) {
        event.set('send.error', String(err))
      }

      event.set('send.sent_to_followers', sentToFollowers)

      await this.ctx.db.createExternalReply({
        atUri: replyAtUri,
        parentAtUri,
        authorDid: replyAuthorDid,
        apNoteId: noteId.href,
        createdAt: new Date().toISOString(),
      })

      event.setOutcome(sentToFollowers ? 'success' : 'error')
      event.emit()
    } catch (err) {
      event.setError(err instanceof Error ? err : new Error(String(err)))
      event.setOutcome('error')
      event.emit()
    }
  }
}
