import { integrateFederation } from '@fedify/express'
import { AppContext } from '../context'
import { setupActorDispatcher } from './actor'
import { setupFollowersDispatcher } from './followers'
import { setupFollowingDispatcher } from './following'
import { setupInboxListeners } from './inbox'
import { setupOutboxDispatcher, recordConverterRegistry } from './outbox'
import { setupNodeInfoDispatcher } from './nodeinfo'

export { recordConverterRegistry }

export function setupFederation(ctx: AppContext) {
  setupNodeInfoDispatcher(ctx)
  setupActorDispatcher(ctx)
  setupFollowersDispatcher(ctx)
  setupFollowingDispatcher(ctx)
  setupInboxListeners(ctx)
  setupOutboxDispatcher(ctx)
}

export function createRouter(ctx: AppContext) {
  setupFederation(ctx)
  return integrateFederation(ctx.federation, () => {})
}
