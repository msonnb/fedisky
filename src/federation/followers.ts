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
            'dispatching followers: {identifier} {followersCount} items, cursor={cursor}',
            {
              identifier,
              followersCount: follows.length,
              cursor,
            },
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
            'failed to dispatch followers: {identifier} {cursor} {err}',
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
        return await ctx.db.getFollowsCount(identifier)
      } catch (err) {
        apLogger.warn('failed to count followers: {identifier} {err}', {
          err,
          identifier,
        })
        return 0
      }
    })
    .setFirstCursor(() =>
      Temporal.Now.zonedDateTimeISO('UTC').add({ days: 1 }).toString(),
    )
}
