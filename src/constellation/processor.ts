import crypto from 'node:crypto'
import { AtUri } from '@atproto/syntax'
import { Create, Note, PUBLIC_COLLECTION } from '@fedify/vocab'
import { Temporal } from '@js-temporal/polyfill'
import escapeHtml from 'escape-html'
import type { AppContext } from '../context'
import { apLogger } from '../logger'
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
    apLogger.info('starting constellation processor', {
      pollInterval: this.ctx.cfg.constellation.pollInterval,
    })

    this.schedulePoll()
  }

  async stop(): Promise<void> {
    apLogger.info('stopping constellation processor')
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
        apLogger.error('constellation poll failed', { err })
      }
      this.schedulePoll()
    }, this.ctx.cfg.constellation.pollInterval)
  }

  private async poll(): Promise<void> {
    const posts = await this.ctx.db.getMonitoredPostsBatch(BATCH_SIZE)

    if (posts.length === 0) {
      apLogger.debug('no monitored posts to check')
      return
    }

    apLogger.debug('checking monitored posts', { count: posts.length })

    for (const post of posts) {
      try {
        await this.checkPostForReplies(post.atUri, post.authorDid)
        await this.ctx.db.updateMonitoredPostLastChecked(post.atUri)
      } catch (err) {
        apLogger.warn('failed to check post for replies', {
          err,
          atUri: post.atUri,
        })
      }
    }
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

    apLogger.debug('found replies to monitored post', {
      postAtUri,
      replyCount: backlinks.length,
    })

    for (const reply of backlinks) {
      try {
        await this.processReply(reply.uri, postAtUri, postAuthorDid)
      } catch (err) {
        apLogger.warn('failed to process reply', { err, replyUri: reply.uri })
      }
    }
  }

  private async processReply(
    replyAtUri: string,
    parentAtUri: string,
    parentAuthorDid: string,
  ): Promise<void> {
    const existing = await this.ctx.db.getExternalReply(replyAtUri)
    if (existing) {
      return
    }

    const replyUri = new AtUri(replyAtUri)
    const replyAuthorDid = replyUri.host

    // Skip if the author is a local PDS user (firehose processor handles those)
    const localAccount = await this.ctx.pdsClient.getAccount(replyAuthorDid)
    if (localAccount) {
      apLogger.debug('skipping reply from local user', {
        replyAtUri,
        replyAuthorDid,
      })
      return
    }

    if (
      (this.ctx.mastodonBridgeAccount.isAvailable() &&
        replyAuthorDid === this.ctx.mastodonBridgeAccount.did) ||
      (this.ctx.blueskyBridgeAccount.isAvailable() &&
        replyAuthorDid === this.ctx.blueskyBridgeAccount.did)
    ) {
      apLogger.debug('skipping reply from bridge account', {
        replyAtUri,
        replyAuthorDid,
      })
      return
    }

    const record = await this.ctx.appViewClient.getRecord(
      replyAuthorDid,
      'app.bsky.feed.post',
      replyUri.rkey,
    )

    if (!record) {
      apLogger.warn('could not fetch reply record from appview', { replyAtUri })
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

    const authorProfileUrl = `https://bsky.app/profile/${replyAuthorDid}`
    const authorLink = `<a href="${authorProfileUrl}">${authorHandle}</a>`
    const attributionHtml = `<p>${authorLink} replied:</p>`
    const contentHtml = `<p>${escapeHtml(replyValue.text ?? '')}</p>`

    const fedifyContext = this.ctx.federation.createContext(
      new URL(this.ctx.cfg.service.publicUrl),
    )

    const blueskyBridgeDid = this.ctx.blueskyBridgeAccount.did
    if (!blueskyBridgeDid) {
      apLogger.warn('bluesky bridge account not available')
      return
    }

    const noteId = new URL(
      `/posts/${encodeURIComponent(replyAtUri)}`,
      this.ctx.cfg.service.publicUrl,
    )

    const parentNoteId = new URL(
      `/posts/${encodeURIComponent(parentAtUri)}`,
      this.ctx.cfg.service.publicUrl,
    )

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

    // Send to all followers of the parent post author
    const followers = await this.ctx.db.getFollowers(parentAuthorDid)

    try {
      await fedifyContext.sendActivity(
        { identifier: blueskyBridgeDid },
        followers.map((follower) => ({
          id: new URL(follower.actorUri),
          inboxId: new URL(follower.actorInbox),
        })),
        activity,
      )
    } catch (err) {
      apLogger.debug('failed to send reply to followers', { err })
    }

    apLogger.info('federated external bluesky reply to ActivityPub', {
      replyAtUri,
      parentAtUri,
      authorHandle,
      noteId: noteId.href,
      followerCount: followers.length,
    })

    await this.ctx.db.createExternalReply({
      atUri: replyAtUri,
      parentAtUri,
      authorDid: replyAuthorDid,
      apNoteId: noteId.href,
      createdAt: new Date().toISOString(),
    })
  }
}
