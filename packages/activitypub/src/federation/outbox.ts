import { Note } from '@fedify/fedify'
import { AtUri } from '@atproto/syntax'
import { AppContext } from '../context'
import { apLogger } from '../logger'
import { RecordConverterRegistry, postConverter } from '../conversion'

export const recordConverterRegistry = new RecordConverterRegistry()
recordConverterRegistry.register(postConverter)

export function setupOutboxDispatcher(ctx: AppContext) {
  ctx.federation
    .setOutboxDispatcher(
      '/users/{+identifier}/outbox',
      async (fedCtx, identifier, cursor) => {
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

          const items = await Promise.all(
            records.map(async (record) => {
              try {
                const atUri = new AtUri(record.uri)
                const recordConverter = recordConverterRegistry.get(
                  atUri.collection,
                )
                if (!recordConverter) {
                  apLogger.debug(
                    { collection: atUri.collection },
                    'no converter found for collection',
                  )
                  return null
                }

                const conversionResult = await recordConverter.toActivityPub(
                  fedCtx,
                  identifier,
                  record,
                  ctx.pdsClient,
                )

                if (!conversionResult || !conversionResult.activity) {
                  return null
                }

                return conversionResult.activity
              } catch (err) {
                apLogger.warn(
                  { err, uri: record.uri },
                  'failed to convert record to activity',
                )
                return null
              }
            }),
          )

          const filteredItems = items.filter(
            (item): item is NonNullable<typeof item> => item !== null,
          )
          apLogger.debug(
            { identifier, itemCount: filteredItems.length, cursor },
            'dispatching outbox',
          )
          return {
            items: filteredItems,
            nextCursor,
          }
        } catch (err) {
          apLogger.warn(
            { err, identifier, cursor },
            'failed to dispatch outbox',
          )
          return { items: [], nextCursor: null }
        }
      },
    )
    .setCounter(async (fedCtx, identifier) => {
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
        return total
      } catch (err) {
        apLogger.warn({ err, identifier }, 'failed to count outbox items')
        return 0
      }
    })
    .setFirstCursor(() => '')

  ctx.federation.setObjectDispatcher(
    Note,
    '/posts/{+uri}',
    async (fedCtx, values) => {
      try {
        const atUri = new AtUri(values.uri)
        const identifier = atUri.hostname
        const recordConverter = recordConverterRegistry.get(atUri.collection)

        if (!recordConverter) {
          apLogger.debug(
            { uri: values.uri, collection: atUri.collection },
            'no converter found for object',
          )
          return null
        }

        const record = await ctx.pdsClient.getRecord(
          identifier,
          atUri.collection,
          atUri.rkey,
        )

        if (!record) {
          apLogger.debug({ uri: values.uri }, 'record not found for object')
          return null
        }

        const conversionResult = await recordConverter.toActivityPub(
          fedCtx,
          identifier,
          record,
          ctx.pdsClient,
        )

        if (!conversionResult) {
          apLogger.debug({ uri: values.uri }, 'conversion failed for object')
          return null
        }

        apLogger.debug({ uri: values.uri }, 'dispatching object')
        return conversionResult.object
      } catch (err) {
        apLogger.warn({ err, uri: values.uri }, 'failed to dispatch object')
        return null
      }
    },
  )
}
