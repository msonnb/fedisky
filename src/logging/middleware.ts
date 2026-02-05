import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { runWithWideEvent } from './context'
import { WideEvent } from './wide-event'

/**
 * Express middleware that creates a wide event for each HTTP request.
 *
 * The event is:
 * 1. Created at request start with basic HTTP info
 * 2. Made available via getWideEvent() for enrichment during request processing
 * 3. Automatically emitted with duration and status when the response finishes
 *
 * Example enrichment from a handler:
 * ```typescript
 * const event = getWideEvent()
 * event?.set('actor.did', did)
 * event?.set('activity.type', 'Follow')
 * ```
 */
export function wideEventMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const event = new WideEvent('http_request')
      .set('request_id', getRequestId(req))
      .set('method', req.method)
      .set('path', req.path)
      .set('url', req.originalUrl)
      .set('user_agent', req.headers['user-agent'])
      .set('remote_addr', getRemoteAddr(req))

    // Capture content-type for POST/PUT requests
    if (req.method === 'POST' || req.method === 'PUT') {
      event.set('content_type', req.headers['content-type'])
    }

    // Emit the event when the response finishes
    res.on('finish', () => {
      event
        .set('status_code', res.statusCode)
        .setOutcome(res.statusCode < 400 ? 'success' : 'error')
        .emit()
    })

    // Run the rest of the request chain within the wide event context
    runWithWideEvent(event, () => {
      next()
    })
  }
}

/**
 * Get or generate a request ID.
 * Checks common headers first, then generates a UUID.
 */
function getRequestId(req: Request): string {
  const requestIdHeaders = [
    'x-request-id',
    'x-correlation-id',
    'x-trace-id',
    'traceparent',
  ]

  for (const header of requestIdHeaders) {
    const value = req.headers[header]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  return crypto.randomUUID()
}

/**
 * Get the client's remote address, accounting for proxies.
 */
function getRemoteAddr(req: Request): string | undefined {
  const forwardedFor = req.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string') {
    // x-forwarded-for can contain multiple IPs, the first is the client
    return forwardedFor.split(',')[0].trim()
  }
  return req.socket.remoteAddress
}
