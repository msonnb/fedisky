import { integrateFederation } from '@fedify/express'
import { AppContext } from '../context'
import { setupActorDispatcher } from './actor'
import { setupFollowersDispatcher } from './followers'
import { setupFollowingDispatcher } from './following'
import { setupInboxListeners } from './inbox'
import { setupNodeInfoDispatcher } from './nodeinfo'
import { setupOutboxDispatcher, recordConverterRegistry } from './outbox'

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
