import { AtUri } from '@atproto/syntax'
import { AppContext } from '../context'
import { apLogger } from '../logger'

export function setupFollowingDispatcher(ctx: AppContext) {
  ctx.federation
    .setFollowingDispatcher(
      '/users/{+identifier}/following',
      async (fedCtx, identifier, cursor) => {
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

          apLogger.debug(
            { identifier, followingCount: items.length, cursor },
            'dispatching following',
          )
          return {
            items,
            nextCursor,
          }
        } catch (err) {
          apLogger.warn(
            { err, identifier, cursor },
            'failed to dispatch following',
          )
          return { items: [], nextCursor: null }
        }
      },
    )
    .setCounter(async (fedCtx, identifier) => {
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

        return localAccounts.size
      } catch (err) {
        apLogger.warn({ err, identifier }, 'failed to count following')
        return 0
      }
    })
    .setFirstCursor(() => '')
}
