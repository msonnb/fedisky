/**
 * Wide events logging module.
 *
 * This module implements the "wide events" (canonical log lines) pattern where
 * each request/operation emits a single, context-rich event at completion.
 *
 * Key exports:
 * - WideEvent: Builder class for constructing events
 * - createWideEvent: Factory function for creating events
 * - getWideEvent: Get the current event from async context
 * - runWithWideEvent: Run code within an event context
 * - wideEventMiddleware: Express middleware for HTTP requests
 *
 * Usage for HTTP requests:
 * ```typescript
 * app.use(wideEventMiddleware())
 *
 * // In handlers:
 * const event = getWideEvent()
 * event?.set('actor.did', did)
 * event?.set('activity.type', 'Follow')
 * // Event is automatically emitted when response finishes
 * ```
 *
 * Usage for background operations:
 * ```typescript
 * const event = createWideEvent('firehose_message')
 *   .set('repo', did)
 *   .set('seq', seq)
 *
 * // ... process message ...
 *
 * event.setOutcome('success').emit()
 * ```
 */

export { getWideEvent, runWithWideEvent } from './context'
export { environment } from './environment'
export type { EnvironmentInfo } from './environment'
export { wideEventMiddleware } from './middleware'
export { createWideEvent, WideEvent } from './wide-event'
export type { Outcome } from './wide-event'
