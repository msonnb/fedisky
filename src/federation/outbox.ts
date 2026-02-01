import { AtUri } from '@atproto/syntax'
import { Note } from '@fedify/vocab'
import { AppContext } from '../context'
import {
  RecordConverterRegistry,
  likeConverter,
  postConverter,
  repostConverter,
} from '../conversion'
import { apLogger } from '../logger'

export const recordConverterRegistry = new RecordConverterRegistry()
recordConverterRegistry.register(postConverter)
recordConverterRegistry.register(likeConverter)
recordConverterRegistry.register(repostConverter)

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
                    'no converter found for collection: {collection}',
                    {
                      collection: atUri.collection,
                    },
                  )
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
              } catch (err) {
                apLogger.warn(
                  'failed to convert record to activity: {uri} {err}',
                  {
                    err,
                    uri: record.uri,
                  },
                )
                return null
              }
            }),
          )

          const filteredItems = items.filter(
            (item): item is NonNullable<typeof item> => item !== null,
          )
          apLogger.debug(
            'dispatching outbox: {identifier} {itemCount} items, cursor={cursor}',
            {
              identifier,
              itemCount: filteredItems.length,
              cursor,
            },
          )
          return {
            items: filteredItems,
            nextCursor,
          }
        } catch (err) {
          apLogger.warn(
            'failed to dispatch outbox: {identifier} {cursor} {err}',
            {
              err,
              identifier,
              cursor,
            },
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
        apLogger.warn('failed to count outbox items: {identifier} {err}', {
          err,
          identifier,
        })
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
          apLogger.debug('no converter found for object: {uri} {collection}', {
            uri: values.uri,
            collection: atUri.collection,
          })
          return null
        }

        const record = await ctx.pdsClient.getRecord(
          identifier,
          atUri.collection,
          atUri.rkey,
        )

        if (!record) {
          apLogger.debug('record not found for object: {uri}', {
            uri: values.uri,
          })
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
          apLogger.debug('conversion failed for object: {uri}', {
            uri: values.uri,
          })
          return null
        }

        apLogger.debug('dispatching object: {uri}', { uri: values.uri })
        return conversionResult.object
      } catch (err) {
        apLogger.warn('failed to dispatch object: {uri} {err}', {
          err,
          uri: values.uri,
        })
        return null
      }
    },
  )
}
