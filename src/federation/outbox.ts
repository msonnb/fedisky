import { AtUri } from '@atproto/syntax'
import { Note } from '@fedify/vocab'
import { AppContext } from '../context'
import {
  RecordConverterRegistry,
  likeConverter,
  postConverter,
  repostConverter,
} from '../conversion'
import { getWideEvent } from '../logging'

export const recordConverterRegistry = new RecordConverterRegistry()
recordConverterRegistry.register(postConverter)
recordConverterRegistry.register(likeConverter)
recordConverterRegistry.register(repostConverter)

export function setupOutboxDispatcher(ctx: AppContext) {
  ctx.federation
    .setOutboxDispatcher(
      '/users/{+identifier}/outbox',
      async (fedCtx, identifier, cursor) => {
        const event = getWideEvent()
        event?.set('dispatch.type', 'outbox')
        event?.set('actor.identifier', identifier)
        event?.set('outbox.cursor', cursor)

        try {
          const limit = 50
          const collections = recordConverterRegistry
            .getAll()
            .map((converter) => converter.collection)

          const allRecords: Array<{
            uri: string
            cid: string
            value: unknown
            collection: string
          }> = []

          for (const collection of collections) {
            const { records } = await ctx.pdsClient.listRecords(
              identifier,
              collection,
              {
                limit: limit + 1,
                reverse: true,
                cursor: cursor ?? undefined,
              },
            )
            allRecords.push(...records.map((r) => ({ ...r, collection })))
          }

          allRecords.sort((a, b) => {
            const aRkey = new AtUri(a.uri).rkey
            const bRkey = new AtUri(b.uri).rkey
            return bRkey.localeCompare(aRkey) // descending
          })

          const records = allRecords.slice(0, limit + 1)
          let nextCursor: string | null = null
          if (records.length > limit) {
            records.pop()
            const lastRecord = records[records.length - 1]
            nextCursor = new AtUri(lastRecord.uri).rkey
          }

          let conversionErrors = 0
          const items = await Promise.all(
            records.map(async (record) => {
              try {
                const atUri = new AtUri(record.uri)
                const recordConverter = recordConverterRegistry.get(
                  atUri.collection,
                )
                if (!recordConverter) {
                  return null
                }

                const conversionResult = await recordConverter.toActivityPub(
                  fedCtx,
                  identifier,
                  record,
                  ctx.pdsClient,
                  { db: ctx.db },
                )

                if (!conversionResult || !conversionResult.activity) {
                  return null
                }

                return conversionResult.activity
              } catch {
                conversionErrors++
                return null
              }
            }),
          )

          const filteredItems = items.filter(
            (item): item is NonNullable<typeof item> => item !== null,
          )

          event?.set('outbox.item_count', filteredItems.length)
          event?.set('outbox.next_cursor', nextCursor)
          if (conversionErrors > 0) {
            event?.set('outbox.conversion_errors', conversionErrors)
          }
          event?.set('dispatch.result', 'success')

          return {
            items: filteredItems,
            nextCursor,
          }
        } catch (err) {
          event?.setError(err instanceof Error ? err : new Error(String(err)))
          event?.set('dispatch.result', 'error')
          return { items: [], nextCursor: null }
        }
      },
    )
    .setCounter(async (fedCtx, identifier) => {
      const event = getWideEvent()
      event?.set('dispatch.type', 'outbox_count')
      event?.set('actor.identifier', identifier)

      try {
        let total = 0
        for (const converter of recordConverterRegistry.getAll()) {
          const { records } = await ctx.pdsClient.listRecords(
            identifier,
            converter.collection,
            { reverse: true },
          )
          total += records.length
        }
        event?.set('outbox.total_count', total)
        event?.set('dispatch.result', 'success')
        return total
      } catch (err) {
        event?.setError(err instanceof Error ? err : new Error(String(err)))
        event?.set('dispatch.result', 'error')
        return 0
      }
    })
    .setFirstCursor(() => '')

  ctx.federation.setObjectDispatcher(
    Note,
    '/posts/{+uri}',
    async (fedCtx, values) => {
      const event = getWideEvent()
      event?.set('dispatch.type', 'object')
      event?.set('object.uri', values.uri)

      try {
        const atUri = new AtUri(values.uri)
        const identifier = atUri.hostname
        event?.set('actor.identifier', identifier)
        event?.set('object.collection', atUri.collection)

        const recordConverter = recordConverterRegistry.get(atUri.collection)

        if (!recordConverter) {
          event?.set('dispatch.result', 'no_converter')
          return null
        }

        const record = await ctx.pdsClient.getRecord(
          identifier,
          atUri.collection,
          atUri.rkey,
        )

        if (!record) {
          event?.set('dispatch.result', 'not_found')
          return null
        }

        const conversionResult = await recordConverter.toActivityPub(
          fedCtx,
          identifier,
          record,
          ctx.pdsClient,
          { db: ctx.db },
        )

        if (!conversionResult) {
          event?.set('dispatch.result', 'conversion_failed')
          return null
        }

        event?.set('dispatch.result', 'success')
        return conversionResult.object
      } catch (err) {
        event?.setError(err instanceof Error ? err : new Error(String(err)))
        event?.set('dispatch.result', 'error')
        return null
      }
    },
  )
}
