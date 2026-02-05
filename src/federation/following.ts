import { AtUri } from '@atproto/syntax'
import { AppContext } from '../context'
import { getWideEvent } from '../logging'

export function setupFollowingDispatcher(ctx: AppContext) {
  ctx.federation
    .setFollowingDispatcher(
      '/users/{+identifier}/following',
      async (fedCtx, identifier, cursor) => {
        const event = getWideEvent()
        event?.set('dispatch.type', 'following')
        event?.set('actor.identifier', identifier)
        event?.set('following.cursor', cursor)

        try {
          const limit = 50
          const { records: followRecords } = await ctx.pdsClient.listRecords(
            identifier,
            'app.bsky.graph.follow',
            {
              limit: limit + 1,
              reverse: true,
              cursor: cursor ?? undefined,
            },
          )

          let nextCursor: string | null = null
          if (followRecords.length > limit) {
            followRecords.pop()
            const lastRecord = followRecords[followRecords.length - 1]
            nextCursor = new AtUri(lastRecord.uri).rkey
          }

          const followedDids = followRecords.map(
            (record) => (record.value as { subject: string }).subject,
          )

          const localAccounts = await ctx.pdsClient.getAccounts(followedDids)

          const items = followRecords
            .filter((record) =>
              localAccounts.has((record.value as { subject: string }).subject),
            )
            .map((record) =>
              fedCtx.getActorUri((record.value as { subject: string }).subject),
            )

          event?.set('following.count', items.length)
          event?.set('following.next_cursor', nextCursor)
          event?.set('dispatch.result', 'success')

          return {
            items,
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
      event?.set('dispatch.type', 'following_count')
      event?.set('actor.identifier', identifier)

      try {
        const { records: allFollowRecords } = await ctx.pdsClient.listRecords(
          identifier,
          'app.bsky.graph.follow',
          {
            limit: 100,
            reverse: true,
          },
        )

        const followedDids = allFollowRecords.map(
          (record) => (record.value as { subject: string }).subject,
        )

        const localAccounts = await ctx.pdsClient.getAccounts(followedDids)

        event?.set('following.total_count', localAccounts.size)
        event?.set('dispatch.result', 'success')
        return localAccounts.size
      } catch (err) {
        event?.setError(err instanceof Error ? err : new Error(String(err)))
        event?.set('dispatch.result', 'error')
        return 0
      }
    })
    .setFirstCursor(() => '')
}
