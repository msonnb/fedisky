import { Outbox, SeqEvt, Sequencer } from '../sequencer'
import AppContext from '../context'
import { recordConverterRegistry } from './federation'
import { AtUri } from '@atproto/syntax'
import { apLogger } from '../logger'
import { LocalViewer } from '../read-after-write/viewer'

export class APOutbox {
  private outbox: Outbox

  constructor(
    private ctx: AppContext,
    sequencer: Sequencer,
  ) {
    this.outbox = new Outbox(sequencer)
  }

  async start() {
    apLogger.info('starting ActivityPub outbox processor')
    try {
      for await (const evt of this.outbox.events()) {
        await this.processEvent(evt)
      }
    } catch (err) {
      apLogger.error({ err }, 'ActivityPub outbox processor crashed')
      throw err
    }
  }

  private async processEvent(evt: SeqEvt) {
    if (evt.type !== 'commit') return

    for (const op of evt.evt.ops) {
      if (op.action === 'create') {
        const collection = op.path.split('/')[0]
        const recordConverter = recordConverterRegistry.get(collection)
        if (!recordConverter) {
          apLogger.debug(
            { collection, path: op.path },
            'no converter registered for collection, skipping',
          )
          continue
        }

        const did = evt.evt.repo
        const uri = `at://${did}/${op.path}`
        const fedifyContext = this.ctx.federation.createContext(
          //new URL(`https://${this.ctx.cfg.service.hostname}`),
          new URL('https://fa04a8aa3e69.ngrok-free.app'),
        )

        let result: {
          record: { uri: string; cid: string; value: unknown } | null
          localViewer: LocalViewer
        } | null = null

        try {
          result = await this.ctx.actorStore.read(did, async (store) => {
            const localViewer = this.ctx.localViewer(store)

            const record = await store.record.getRecord(new AtUri(uri), null)

            return { record, localViewer }
          })
        } catch (err) {
          apLogger.debug(
            { did, uri, err },
            'skipping event: failed to read actor store (repo may have been deleted)',
          )
          continue
        }

        if (!result?.record) {
          apLogger.debug({ did, uri }, 'skipping event: record not found')
          continue
        }

        let conversionResult
        try {
          conversionResult = await recordConverter.toActivityPub(
            fedifyContext,
            did,
            result.record,
            result.localViewer,
          )
        } catch (err) {
          apLogger.warn(
            { did, uri, err },
            'failed to convert record to ActivityPub',
          )
          continue
        }

        if (!conversionResult) {
          apLogger.debug(
            { did, uri },
            'skipping event: conversion returned null',
          )
          continue
        }
        const activity = conversionResult.activity
        if (!activity) {
          apLogger.debug(
            { did, uri },
            'skipping event: conversion returned no activity',
          )
          continue
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
              activity: {
                id: activity.id?.href,
                actor: activity.actorId?.href,
                to: activity.toId,
                cc: activity.ccId,
                objectId: activity.objectId?.href,
              },
            },
            'sent activity to followers',
          )
        } catch (err) {
          apLogger.warn(
            { did, uri, activityId: activity.id?.href, err },
            'failed to send activity to followers',
          )
        }
      }
    }
  }
}
