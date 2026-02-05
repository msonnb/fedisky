import { getLogger } from '@logtape/logtape'
import { environment } from './environment'

const logger = getLogger(['fedisky', 'events'])

export type Outcome = 'success' | 'error' | 'ignored'

/**
 * WideEvent builder class for constructing canonical log lines.
 *
 * Wide events (canonical log lines) emit a single, context-rich event at the
 * completion of each request/operation. This pattern enables powerful debugging
 * and analytics by ensuring all relevant context is in one log line.
 *
 * Usage:
 * ```typescript
 * const event = new WideEvent('http_request')
 *   .set('method', 'POST')
 *   .set('path', '/inbox')
 *   .setUser({ did: 'did:plc:xyz', handle: 'user.bsky.social' })
 *
 * // ... do work, enriching the event as you go ...
 * event.set('activity.type', 'Follow')
 *
 * // At completion:
 * event.set('outcome', 'success').emit()
 * ```
 */
export class WideEvent {
  private data: Record<string, unknown> = {}
  private startTime: number

  constructor(type: string) {
    this.startTime = Date.now()
    this.data.type = type
    this.data.timestamp = new Date().toISOString()
    // Include environment info in every event
    this.data.environment = { ...environment }
  }

  /**
   * Set a key-value pair on the event.
   * Supports dot notation for nested objects (e.g., 'actor.did').
   */
  set(key: string, value: unknown): this {
    if (value === undefined || value === null) {
      return this
    }
    this.setNestedValue(key, value)
    return this
  }

  /**
   * Set multiple key-value pairs at once.
   */
  setAll(data: Record<string, unknown>): this {
    for (const [key, value] of Object.entries(data)) {
      this.set(key, value)
    }
    return this
  }

  /**
   * Set user/actor context on the event.
   */
  setUser(user: { did: string; handle?: string }): this {
    this.set('user.did', user.did)
    if (user.handle) {
      this.set('user.handle', user.handle)
    }
    return this
  }

  /**
   * Set error information on the event.
   */
  setError(error: Error): this {
    this.set('error.message', error.message)
    this.set('error.name', error.name)
    if (error.stack) {
      // Only include first few lines of stack
      const stackLines = error.stack.split('\n').slice(0, 5)
      this.set('error.stack', stackLines.join('\n'))
    }
    return this
  }

  /**
   * Set the outcome of the operation.
   */
  setOutcome(outcome: Outcome): this {
    this.set('outcome', outcome)
    return this
  }

  /**
   * Get the current value of a key.
   */
  get(key: string): unknown {
    const parts = key.split('.')
    let current: unknown = this.data
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  /**
   * Emit the wide event to the logger.
   * Automatically calculates duration_ms from event creation time.
   */
  emit(): void {
    this.data.duration_ms = Date.now() - this.startTime
    logger.info('wide event: {data}', { data: this.data })
  }

  /**
   * Get a copy of the event data (useful for testing).
   */
  toJSON(): Record<string, unknown> {
    return { ...this.data, duration_ms: Date.now() - this.startTime }
  }

  private setNestedValue(key: string, value: unknown): void {
    const parts = key.split('.')
    let current = this.data

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    current[parts[parts.length - 1]] = value
  }
}

/**
 * Create a new WideEvent with the given type.
 * Convenience function for creating wide events.
 */
export function createWideEvent(type: string): WideEvent {
  return new WideEvent(type)
}
