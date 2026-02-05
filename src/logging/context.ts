import { AsyncLocalStorage } from 'node:async_hooks'
import type { WideEvent } from './wide-event'

/**
 * AsyncLocalStorage for propagating WideEvent context through async call stacks.
 * This allows any code in the request chain to enrich the current wide event
 * without explicitly passing it through function parameters.
 */
const requestContext = new AsyncLocalStorage<WideEvent>()

/**
 * Get the current WideEvent from the async context.
 * Returns undefined if not within a wide event context.
 */
export function getWideEvent(): WideEvent | undefined {
  return requestContext.getStore()
}

/**
 * Run a function within a wide event context.
 * The event will be available via getWideEvent() within the function and all async calls it makes.
 */
export function runWithWideEvent<T>(event: WideEvent, fn: () => T): T {
  return requestContext.run(event, fn)
}
