import { cborDecodeMulti } from '@atproto/common'
import { AtUri } from '@atproto/syntax'
import {
  Activity,
  Announce,
  Context,
  Delete,
  Note,
  PUBLIC_COLLECTION,
  Undo,
} from '@fedify/fedify'
import { WebSocket } from 'ws'
import { AppContext } from '../context'
import type { RecordConverter } from '../conversion'
import { recordConverterRegistry } from '../federation'
import { apLogger } from '../logger'

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
    apLogger.info('starting firehose processor')

    try {
      await this.connect()
    } catch (err) {
      apLogger.error({ err }, 'firehose processor crashed')
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
    apLogger.info({ url: fullUrl }, 'connecting to firehose')

    const ws = new WebSocket(fullUrl)

    ws.on('open', () => {
      apLogger.info('connected to firehose')
    })

    ws.on('message', async (data: Buffer) => {
      try {
        await this.processMessage(data)
      } catch (err) {
        apLogger.warn({ err }, 'failed to process firehose message')
      }
    })

    ws.on('error', (err) => {
      apLogger.error({ err }, 'firehose websocket error')
    })

    ws.on('close', () => {
      apLogger.info('firehose connection closed')
      if (this.running) {
        // Reconnect after a delay
        setTimeout(() => {
          if (this.running) {
            this.connect().catch((err) => {
              apLogger.error({ err }, 'failed to reconnect to firehose')
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
        apLogger.debug('frame missing header or body')
        return
      }

      const [header, body] = decoded as [FrameHeader, Record<string, unknown>]

      // Only process message frames (op=1), skip error frames (op=-1)
      if (header.op !== FrameType.Message) {
        if (header.op === FrameType.Error) {
          apLogger.warn({ error: body }, 'received error frame from firehose')
        }
        return
      }

      // Check the message type from the header
      // The type is stored in header.t as '#commit', '#identity', '#account', etc.
      if (header.t !== '#commit') {
        return
      }

      const event: CommitEvent = {
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

      await this.processCommit(event)
    } catch (err) {
      // Log but don't throw - we want to continue processing
      apLogger.debug({ err }, 'failed to decode firehose message')
    }
  }

  private async processCommit(event: CommitEvent) {
    const did = event.repo

    // Skip events from the bridge account - it should not federate to ActivityPub
    if (
      this.ctx.bridgeAccount.isAvailable() &&
      did === this.ctx.bridgeAccount.did
    ) {
      apLogger.debug({ did }, 'skipping commit from bridge account')
      return
    }

    for (const op of event.ops) {
      const collection = op.path.split('/')[0]
      const recordConverter = recordConverterRegistry.get(collection)
      if (!recordConverter) {
        apLogger.debug(
          { collection, path: op.path },
          'no converter registered for collection, skipping',
        )
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
        )
      } else if (op.action === 'delete') {
        await this.processDelete(fedifyContext, did, uri)
      }
    }
  }

  private async processCreate(
    fedifyContext: Context<void>,
    did: string,
    uri: string,
    collection: string,
    recordConverter: RecordConverter | undefined,
  ) {
    if (!recordConverter) return

    try {
      const record = await this.ctx.pdsClient.getRecord(
        did,
        collection,
        new AtUri(uri).rkey,
      )

      if (!record) {
        apLogger.debug({ did, uri }, 'skipping event: record not found')
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
        apLogger.debug(
          { did, uri },
          'skipping event: conversion returned null or no activity',
        )
        return
      }

      const activity = conversionResult.activity

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
        }
      }

      try {
        await fedifyContext.sendActivity(
          { identifier: did },
          'followers',
          activity,
        )
        apLogger.info(
          {
            did,
            uri,
            activityId: activity.id?.href,
          },
          'sent activity to followers',
        )
      } catch (sendErr) {
        apLogger.warn(
          { did, uri, activityId: activity.id?.href, err: sendErr },
          'failed to send activity to followers',
        )
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
            apLogger.info(
              {
                did,
                uri,
                activityId: activity.id?.href,
                originalAuthorInbox,
              },
              'sent reply activity to original AP author',
            )
          } catch (sendErr) {
            apLogger.warn(
              {
                did,
                uri,
                activityId: activity.id?.href,
                originalAuthorInbox,
                err: sendErr,
              },
              'failed to send reply activity to original AP author',
            )
          }
        }
      }
    } catch (err) {
      apLogger.warn(
        { did, uri, err },
        'failed to process commit for AP delivery',
      )
    }
  }

  private async processDelete(
    fedifyContext: Context<void>,
    did: string,
    uri: string,
  ) {
    try {
      const activity = this.buildDeleteActivity(fedifyContext, did, uri)

      if (!activity) {
        apLogger.debug({ did, uri }, 'skipping event: no activity to send')
        return
      }

      await this.sendActivityToFollowers({
        fedifyContext,
        did,
        activity,
      })
    } catch (err) {
      apLogger.warn(
        { did, uri, err },
        'failed to process delete for AP delivery',
      )
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
  }) {
    const { fedifyContext, did, activity } = opts
    const activityType = activity.constructor.name

    try {
      await fedifyContext.sendActivity(
        { identifier: did },
        'followers',
        activity,
      )
      apLogger.info(
        {
          did,
          activityId: activity.id?.href,
          activityType,
          objectId: activity.objectId?.href,
        },
        'sent activity to followers',
      )
    } catch (sendErr) {
      apLogger.warn(
        {
          did,
          activityId: activity.id?.href,
          err: sendErr,
          activityType,
          objectId: activity.objectId?.href,
        },
        'failed to send activity to followers',
      )
    }
  }

  async stop() {
    apLogger.info('stopping firehose processor')
    this.running = false
    this.abortController?.abort()
    this.abortController = null
  }
}
