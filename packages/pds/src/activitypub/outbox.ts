import { Outbox, SeqEvt, Sequencer } from '../sequencer'
import AppContext from '../context'
import { recordConverterRegistry } from './federation'
import { AtUri } from '@atproto/syntax'
import { apLogger } from '../logger'

export class APOutbox {
  private outbox: Outbox

  constructor(
    private ctx: AppContext,
    sequencer: Sequencer,
  ) {
    this.outbox = new Outbox(sequencer)
  }

  async start() {
    for await (const evt of this.outbox.events()) {
      await this.processEvent(evt)
    }
  }

  private async processEvent(evt: SeqEvt) {
    if (evt.type !== 'commit') return

    for (const op of evt.evt.ops) {
      if (op.action === 'create') {
        const recordConverter = recordConverterRegistry.get(
          op.path.split('/')[0],
        )
        if (!recordConverter) {
          continue
        }

        const did = evt.evt.repo
        const fedifyContext = this.ctx.federation.createContext(
          new URL(`https://${this.ctx.cfg.service.hostname}`),
        )
        const result = await this.ctx.actorStore.read(did, async (store) => {
          const localViewer = this.ctx.localViewer(store)

          const record = await store.record.getRecord(
            new AtUri(`at://${did}/${op.path}`),
            null,
          )

          return { record, localViewer }
        })

        if (!result.record) {
          continue
        }
        const conversionResult = await recordConverter.toActivityPub(
          fedifyContext,
          did,
          result.record,
          result.localViewer,
        )
        if (!conversionResult) {
          continue
        }
        const activity = conversionResult.activity
        if (!activity) {
          continue
        }
        await fedifyContext.sendActivity(
          { identifier: did },
          'followers',
          activity,
        )
        apLogger.info({ did, activity }, 'sent activity')
      }
    }
  }
}
