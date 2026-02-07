import { Temporal } from '@js-temporal/polyfill'
import { AppContext } from '../context'
import { getWideEvent } from '../logging'

export function setupFollowersDispatcher(ctx: AppContext) {
  ctx.federation
    .setFollowersDispatcher(
      '/users/{+identifier}/followers',
      async (fedCtx, identifier, cursor) => {
        const event = getWideEvent()
        event?.set('dispatch.type', 'followers')
        event?.set('actor.identifier', identifier)
        event?.set('followers.cursor', cursor)

        try {
          const { follows, nextCursor } = await ctx.db.getFollows({
            userDid: identifier,
            cursor,
            limit: 50,
          })

          event?.set('followers.count', follows.length)
          event?.set('followers.next_cursor', nextCursor)
          event?.set('dispatch.result', 'success')

          return {
            items: follows.map((follow) => ({
              id: new URL(follow.actorUri),
              inboxId: new URL(follow.actorInbox),
              endpoints: follow.actorSharedInbox
                ? { sharedInbox: new URL(follow.actorSharedInbox) }
                : null,
            })),
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
      event?.set('dispatch.type', 'followers_count')
      event?.set('actor.identifier', identifier)

      try {
        const count = await ctx.db.getFollowsCount(identifier)
        event?.set('followers.total_count', count)
        event?.set('dispatch.result', 'success')
        return count
      } catch (err) {
        event?.setError(err instanceof Error ? err : new Error(String(err)))
        event?.set('dispatch.result', 'error')
        return 0
      }
    })
    .setFirstCursor(() =>
      Temporal.Now.zonedDateTimeISO('UTC').add({ days: 1 }).toString(),
    )
}
