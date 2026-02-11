import { AtUri } from '@atproto/syntax'
import type { AppContext } from '../context'
import type { APLike } from '../db/schema/like'
import type { APRepost } from '../db/schema/repost'
import { logger } from '../logger'
import { createWideEvent } from '../logging'
import { ActorResolver } from './actor-resolver'
import { ChatClient } from './chat-client'
import { formatNotificationMessage, PostEngagement } from './message-formatter'

const BATCH_LIMIT = 200

interface GroupedEngagement {
  likes: APLike[]
  reposts: APRepost[]
}

/**
 * Background processor that periodically checks for un-notified likes/reposts,
 * batches them by author, and sends summary DMs via the Bluesky Chat API.
 */
export class DmNotificationProcessor {
  private ctx: AppContext
  private chatClient: ChatClient
  private running = false
  private pollTimer?: ReturnType<typeof setTimeout>

  constructor(ctx: AppContext, chatClient: ChatClient) {
    this.ctx = ctx
    this.chatClient = chatClient
  }

  async start(): Promise<void> {
    if (this.running) return

    this.running = true
    logger.info('dm notification processor starting', {
      pollInterval: this.ctx.cfg.dmNotifications.pollInterval,
      batchDelay: this.ctx.cfg.dmNotifications.batchDelay,
    })

    this.schedulePoll()
  }

  async stop(): Promise<void> {
    logger.info('dm notification processor stopping')
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
        logger.error('dm notification poll failed', { err })
      }
      this.schedulePoll()
    }, this.ctx.cfg.dmNotifications.pollInterval)
  }

  async poll(): Promise<void> {
    const event = createWideEvent('dm_notification_poll')

    const olderThan = new Date(
      Date.now() - this.ctx.cfg.dmNotifications.batchDelay,
    ).toISOString()

    const likes = await this.ctx.db.getUnnotifiedLikes(olderThan, BATCH_LIMIT)
    const reposts = await this.ctx.db.getUnnotifiedReposts(
      olderThan,
      BATCH_LIMIT,
    )

    event.set('poll.likes_count', likes.length)
    event.set('poll.reposts_count', reposts.length)

    if (likes.length === 0 && reposts.length === 0) {
      event.setOutcome('success').emit()
      return
    }

    // Group by author
    const byAuthor = new Map<string, GroupedEngagement>()

    for (const like of likes) {
      let group = byAuthor.get(like.postAuthorDid)
      if (!group) {
        group = { likes: [], reposts: [] }
        byAuthor.set(like.postAuthorDid, group)
      }
      group.likes.push(like)
    }

    for (const repost of reposts) {
      let group = byAuthor.get(repost.postAuthorDid)
      if (!group) {
        group = { likes: [], reposts: [] }
        byAuthor.set(repost.postAuthorDid, group)
      }
      group.reposts.push(repost)
    }

    event.set('poll.author_count', byAuthor.size)

    const fedifyCtx = this.ctx.federation.createContext(
      new URL(this.ctx.cfg.service.publicUrl),
    )
    const actorResolver = new ActorResolver(fedifyCtx)
    let sentCount = 0
    let errorCount = 0
    let firstFailure = false

    for (const [authorDid, engagement] of byAuthor) {
      if (firstFailure) break

      try {
        const success = await this.notifyAuthor(
          authorDid,
          engagement,
          actorResolver,
        )
        if (success) {
          sentCount++
        } else {
          errorCount++
          // If first DM fails, chat API likely unavailable globally
          if (sentCount === 0) {
            firstFailure = true
            logger.warn(
              'first DM failed, skipping remaining authors this cycle',
            )
          }
        }
      } catch (err) {
        errorCount++
        logger.error('failed to notify author {authorDid}', {
          authorDid,
          err,
        })
        if (sentCount === 0) {
          firstFailure = true
        }
      }
    }

    event.set('poll.sent_count', sentCount)
    if (errorCount > 0) {
      event.set('poll.error_count', errorCount)
    }
    event.setOutcome(errorCount === 0 ? 'success' : 'error')
    event.emit()
  }

  private async notifyAuthor(
    authorDid: string,
    engagement: GroupedEngagement,
    actorResolver: ActorResolver,
  ): Promise<boolean> {
    // Group by post within this author
    const byPost = new Map<string, { likes: APLike[]; reposts: APRepost[] }>()

    for (const like of engagement.likes) {
      let post = byPost.get(like.postAtUri)
      if (!post) {
        post = { likes: [], reposts: [] }
        byPost.set(like.postAtUri, post)
      }
      post.likes.push(like)
    }

    for (const repost of engagement.reposts) {
      let post = byPost.get(repost.postAtUri)
      if (!post) {
        post = { likes: [], reposts: [] }
        byPost.set(repost.postAtUri, post)
      }
      post.reposts.push(repost)
    }

    // Build engagement summaries
    const postEngagements: PostEngagement[] = []

    for (const [postAtUri, postData] of byPost) {
      const postText = await this.fetchPostText(postAtUri)

      const likeNames = await Promise.all(
        postData.likes.map((l) => actorResolver.resolve(l.apActorId)),
      )
      const repostNames = await Promise.all(
        postData.reposts.map((r) => actorResolver.resolve(r.apActorId)),
      )

      postEngagements.push({
        postAtUri,
        postText,
        likes: likeNames,
        reposts: repostNames,
      })
    }

    const message = formatNotificationMessage(postEngagements)
    const success = await this.chatClient.sendDm(authorDid, message)

    if (success) {
      // Mark all likes and reposts as notified
      const likeIds = engagement.likes.map((l) => l.activityId)
      const repostIds = engagement.reposts.map((r) => r.activityId)

      await this.ctx.db.markLikesNotified(likeIds)
      await this.ctx.db.markRepostsNotified(repostIds)
    }

    return success
  }

  private async fetchPostText(postAtUri: string): Promise<string | null> {
    try {
      const uri = new AtUri(postAtUri)
      const record = await this.ctx.pdsClient.getRecord(
        uri.host,
        uri.collection,
        uri.rkey,
      )
      if (record) {
        const value = record.value as { text?: string }
        return value.text ?? null
      }
    } catch (err) {
      logger.warn('failed to fetch post text for {postAtUri}', {
        postAtUri,
        err,
      })
    }
    return null
  }
}
