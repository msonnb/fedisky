import { cborDecodeMulti } from '@atproto/common'
import { AtUri } from '@atproto/syntax'
import type { Context } from '@fedify/fedify'
import {
  Activity,
  Announce,
  Delete,
  Like,
  Note,
  PUBLIC_COLLECTION,
  Undo,
} from '@fedify/vocab'
import { WebSocket } from 'ws'
import { AppContext } from '../context'
import type { RecordConverter } from '../conversion'
import { recordConverterRegistry } from '../federation'
import { logger } from '../logger'
import { createWideEvent } from '../logging'

// Frame types per AT Protocol Event Stream spec
const FrameType = {
  Message: 1,
  Error: -1,
} as const

interface FrameHeader {
  op: number
  t?: string // message type, e.g. '#commit', '#identity', '#account'
}

interface CommitOp {
  action: 'create' | 'update' | 'delete'
  path: string
  cid?: string
}

interface CommitEvent {
  repo: string
  ops: CommitOp[]
  seq: number
}

export class FirehoseProcessor {
  private running = false
  private abortController: AbortController | null = null

  constructor(private ctx: AppContext) {}

  async start() {
    if (this.running) {
      return
    }

    this.running = true
    this.abortController = new AbortController()
    logger.info('firehose processor starting')

    try {
      await this.connect()
    } catch (err) {
      logger.error('firehose processor crashed: {err}', { err })
      this.running = false
      throw err
    }
  }

  private async connect() {
    const url = new URL(this.ctx.cfg.pds.url)
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${url.host}/xrpc/com.atproto.sync.subscribeRepos`

    const params = new URLSearchParams()
    if (this.ctx.cfg.firehose.cursor !== undefined) {
      params.set('cursor', String(this.ctx.cfg.firehose.cursor))
    }

    const fullUrl = params.toString() ? `${wsUrl}?${params}` : wsUrl
    logger.info('connecting to firehose: {url}', { url: fullUrl })

    const ws = new WebSocket(fullUrl)

    ws.on('open', () => {
      logger.info('connected to firehose')
    })

    ws.on('message', async (data: Buffer) => {
      try {
        await this.processMessage(data)
      } catch (err) {
        logger.warn('failed to process firehose message: {err}', { err })
      }
    })

    ws.on('error', (err) => {
      logger.error('firehose websocket error: {err}', { err })
    })

    ws.on('close', () => {
      logger.info('firehose connection closed')
      if (this.running) {
        // Reconnect after a delay
        setTimeout(() => {
          if (this.running) {
            this.connect().catch((err) => {
              logger.error('failed to reconnect to firehose: {err}', { err })
            })
          }
        }, 5000)
      }
    })

    // Handle abort
    this.abortController?.signal.addEventListener('abort', () => {
      ws.close()
    })
  }

  private async processMessage(data: Buffer) {
    // The firehose message is a frame containing two CBOR-encoded items:
    // 1. Header: { op: number, t?: string } where op=1 is Message, op=-1 is Error
    // 2. Body: the actual event data
    // See: https://atproto.com/specs/event-stream

    try {
      const decoded = cborDecodeMulti(data)
      if (decoded.length < 2) {
        return
      }

      const [header, body] = decoded as [FrameHeader, Record<string, unknown>]

      // Only process message frames (op=1), skip error frames (op=-1)
      if (header.op !== FrameType.Message) {
        if (header.op === FrameType.Error) {
          logger.warn('received error frame from firehose: {error}', {
            error: body,
          })
        }
        return
      }

      // Check the message type from the header
      // The type is stored in header.t as '#commit', '#identity', '#account', etc.
      if (header.t !== '#commit') {
        return
      }

      const commitEvent: CommitEvent = {
        repo: (body.repo as string) ?? '',
        ops:
          (
            body.ops as Array<{ action: string; path: string; cid?: unknown }>
          )?.map((op) => ({
            action: op.action as 'create' | 'update' | 'delete',
            path: op.path,
            cid: op.cid?.toString(),
          })) ?? [],
        seq: (body.seq as number) ?? 0,
      }

      await this.processCommit(commitEvent)
    } catch {
      // Silently continue - decode errors are expected for non-commit messages
    }
  }

  private async processCommit(commitEvent: CommitEvent) {
    const did = commitEvent.repo

    // Skip events from bridge accounts - they should not federate to ActivityPub
    if (
      this.ctx.mastodonBridgeAccount.isAvailable() &&
      did === this.ctx.mastodonBridgeAccount.did
    ) {
      return
    }

    if (
      this.ctx.blueskyBridgeAccount.isAvailable() &&
      did === this.ctx.blueskyBridgeAccount.did
    ) {
      return
    }

    for (const op of commitEvent.ops) {
      const collection = op.path.split('/')[0]
      const recordConverter = recordConverterRegistry.get(collection)
      if (!recordConverter) {
        continue
      }

      const uri = `at://${did}/${op.path}`

      const fedifyContext = this.ctx.federation.createContext(
        new URL(this.ctx.cfg.service.publicUrl),
      )

      if (op.action === 'create') {
        await this.processCreate(
          fedifyContext,
          did,
          uri,
          collection,
          recordConverter,
          commitEvent.seq,
        )
      } else if (op.action === 'delete') {
        await this.processDelete(fedifyContext, did, uri, commitEvent.seq)
      }
    }
  }

  private async processCreate(
    fedifyContext: Context<void>,
    did: string,
    uri: string,
    collection: string,
    recordConverter: RecordConverter | undefined,
    seq: number,
  ) {
    if (!recordConverter) return

    const event = createWideEvent('firehose_create')
      .set('firehose.seq', seq)
      .set('firehose.action', 'create')
      .set('user.did', did)
      .set('record.uri', uri)
      .set('record.collection', collection)

    try {
      const record = await this.ctx.pdsClient.getRecord(
        did,
        collection,
        new AtUri(uri).rkey,
      )

      if (!record) {
        event.setOutcome('ignored').set('ignored_reason', 'record_not_found')
        event.emit()
        return
      }

      const conversionResult = await recordConverter.toActivityPub(
        fedifyContext,
        did,
        record,
        this.ctx.pdsClient,
        { db: this.ctx.db },
      )

      if (!conversionResult?.activity) {
        event.setOutcome('ignored').set('ignored_reason', 'conversion_null')
        event.emit()
        return
      }

      const activity = conversionResult.activity
      event.set('activity.type', activity.constructor.name)
      event.set('activity.id', activity.id?.href)

      // Check if this is a reply to a bridge post - if so, also send to the original author
      const recordValue = record.value as {
        reply?: { parent?: { uri: string } }
      }
      let originalAuthorInbox: string | undefined
      if (recordValue.reply?.parent?.uri) {
        const mapping = await this.ctx.db.getPostMapping(
          recordValue.reply.parent.uri,
        )
        if (mapping) {
          originalAuthorInbox = mapping.apActorInbox
          event.set('activity.is_bridge_reply', true)
        }
      }

      let sentToFollowers = false
      try {
        await fedifyContext.sendActivity(
          { identifier: did },
          'followers',
          activity,
        )
        sentToFollowers = true
      } catch (sendErr) {
        event.set('send.followers_error', String(sendErr))
      }

      event.set('send.sent_to_followers', sentToFollowers)

      // Add posts to monitored list for external reply discovery via Constellation
      if (collection === 'app.bsky.feed.post') {
        try {
          await this.ctx.db.createMonitoredPost({
            atUri: uri,
            authorDid: did,
            lastChecked: null,
            createdAt: new Date().toISOString(),
          })
          event.set('monitoring.added', true)
        } catch {
          // Ignore monitoring errors
        }
      }

      // Send to original AP author's inbox if this is a reply to a bridge post
      if (originalAuthorInbox) {
        const mapping = await this.ctx.db.getPostMapping(
          recordValue.reply!.parent!.uri,
        )
        if (mapping) {
          try {
            await fedifyContext.sendActivity(
              { identifier: did },
              {
                id: new URL(mapping.apActorId),
                inboxId: new URL(mapping.apActorInbox),
              },
              activity,
            )
            event.set('send.sent_to_original_author', true)
          } catch (sendErr) {
            event.set('send.original_author_error', String(sendErr))
          }
        }
      }

      event.setOutcome(sentToFollowers ? 'success' : 'error')
      event.emit()
    } catch (err) {
      event.setError(err instanceof Error ? err : new Error(String(err)))
      event.setOutcome('error')
      event.emit()
    }
  }

  private async processDelete(
    fedifyContext: Context<void>,
    did: string,
    uri: string,
    seq: number,
  ) {
    const event = createWideEvent('firehose_delete')
      .set('firehose.seq', seq)
      .set('firehose.action', 'delete')
      .set('user.did', did)
      .set('record.uri', uri)

    try {
      const activity = this.buildDeleteActivity(fedifyContext, did, uri)

      if (!activity) {
        event.setOutcome('ignored').set('ignored_reason', 'no_activity')
        event.emit()
        return
      }

      event.set('activity.type', activity.constructor.name)
      event.set('activity.id', activity.id?.href)

      await this.sendActivityToFollowers({
        fedifyContext,
        did,
        activity,
        event,
      })

      event.setOutcome('success')
      event.emit()
    } catch (err) {
      event.setError(err instanceof Error ? err : new Error(String(err)))
      event.setOutcome('error')
      event.emit()
    }
  }

  private buildDeleteActivity(
    fedifyContext: Context<void>,
    did: string,
    uri: string,
  ) {
    const actor = fedifyContext.getActorUri(did)
    const followersUri = fedifyContext.getFollowersUri(did)

    const atUri = new AtUri(uri)
    switch (atUri.collection) {
      case 'app.bsky.feed.like': {
        const likeId = new URL(
          `/likes/${encodeURIComponent(uri)}`,
          fedifyContext.origin,
        )
        return new Undo({
          id: new URL(`#undo-${Date.now()}`, likeId),
          actor,
          to: PUBLIC_COLLECTION,
          cc: followersUri,
          object: new Like({ id: likeId }),
        })
      }
      case 'app.bsky.feed.repost': {
        const announceId = new URL(
          `/reposts/${encodeURIComponent(uri)}`,
          fedifyContext.origin,
        )
        return new Undo({
          id: new URL(`#undo-${Date.now()}`, announceId),
          actor,
          to: PUBLIC_COLLECTION,
          cc: followersUri,
          object: new Announce({ id: announceId }),
        })
      }
      case 'app.bsky.feed.post': {
        const objectUri = fedifyContext.getObjectUri(Note, { uri })
        return new Delete({
          id: new URL(`#delete-${Date.now()}`, objectUri),
          actor,
          to: PUBLIC_COLLECTION,
          cc: followersUri,
          object: objectUri,
        })
      }
      default:
        return null
    }
  }

  private async sendActivityToFollowers(opts: {
    fedifyContext: Context<void>
    did: string
    activity: Activity
    event?: ReturnType<typeof createWideEvent>
  }) {
    const { fedifyContext, did, activity, event } = opts

    try {
      await fedifyContext.sendActivity(
        { identifier: did },
        'followers',
        activity,
      )
      event?.set('send.sent_to_followers', true)
    } catch (sendErr) {
      event?.set('send.followers_error', String(sendErr))
    }
  }

  async stop() {
    logger.info('firehose processor stopping')
    this.running = false
    this.abortController?.abort()
    this.abortController = null
  }
}
