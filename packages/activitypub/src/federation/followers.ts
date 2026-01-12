import { Temporal } from '@js-temporal/polyfill'
import { AppContext } from '../context'
import { apLogger } from '../logger'

export function setupFollowersDispatcher(ctx: AppContext) {
  ctx.federation
    .setFollowersDispatcher(
      '/users/{+identifier}/followers',
      async (fedCtx, identifier, cursor) => {
        try {
          const { follows, nextCursor } = await ctx.db.getFollows({
            userDid: identifier,
            cursor,
            limit: 50,
          })

          apLogger.debug(
            { identifier, followersCount: follows.length, cursor },
            'dispatching followers',
          )
          return {
            items: follows.map((follow) => ({
              id: new URL(follow.actorUri),
              inboxId: new URL(follow.actorInbox),
            })),
            nextCursor,
          }
        } catch (err) {
          apLogger.warn(
            { err, identifier, cursor },
            'failed to dispatch followers',
          )
          return { items: [], nextCursor: null }
        }
      },
    )
    .setCounter(async (fedCtx, identifier) => {
      try {
        return await ctx.db.getFollowsCount(identifier)
      } catch (err) {
        apLogger.warn({ err, identifier }, 'failed to count followers')
        return 0
      }
    })
    .setFirstCursor(() =>
      Temporal.Now.zonedDateTimeISO('UTC').add({ days: 1 }).toString(),
    )
}
