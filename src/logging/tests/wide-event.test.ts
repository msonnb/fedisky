import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WideEvent, createWideEvent } from '../wide-event'

// Mock logtape to capture log calls
vi.mock('@logtape/logtape', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('WideEvent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-05T12:00:00.000Z'))
  })

  describe('constructor', () => {
    it('sets type and timestamp', () => {
      const event = new WideEvent('http_request')
      const data = event.toJSON()

      expect(data.type).toBe('http_request')
      expect(data.timestamp).toBe('2026-02-05T12:00:00.000Z')
    })

    it('includes environment info', () => {
      const event = new WideEvent('http_request')
      const data = event.toJSON()

      expect(data.environment).toBeDefined()
      expect((data.environment as Record<string, string>).service).toBe(
        'fedisky',
      )
    })
  })

  describe('set()', () => {
    it('sets simple values', () => {
      const event = new WideEvent('test')
        .set('method', 'POST')
        .set('status', 200)

      const data = event.toJSON()
      expect(data.method).toBe('POST')
      expect(data.status).toBe(200)
    })

    it('sets nested values with dot notation', () => {
      const event = new WideEvent('test')
        .set('user.did', 'did:plc:xyz')
        .set('user.handle', 'test.bsky.social')

      const data = event.toJSON()
      expect((data.user as Record<string, string>).did).toBe('did:plc:xyz')
      expect((data.user as Record<string, string>).handle).toBe(
        'test.bsky.social',
      )
    })

    it('ignores null and undefined values', () => {
      const event = new WideEvent('test')
        .set('valid', 'value')
        .set('nullValue', null)
        .set('undefinedValue', undefined)

      const data = event.toJSON()
      expect(data.valid).toBe('value')
      expect('nullValue' in data).toBe(false)
      expect('undefinedValue' in data).toBe(false)
    })

    it('handles deeply nested values', () => {
      const event = new WideEvent('test').set('activity.actor.inbox', '/inbox')

      const data = event.toJSON()
      expect(
        (
          (data.activity as Record<string, unknown>).actor as Record<
            string,
            string
          >
        ).inbox,
      ).toBe('/inbox')
    })
  })

  describe('setAll()', () => {
    it('sets multiple values at once', () => {
      const event = new WideEvent('test').setAll({
        method: 'GET',
        path: '/users/test',
        status: 200,
      })

      const data = event.toJSON()
      expect(data.method).toBe('GET')
      expect(data.path).toBe('/users/test')
      expect(data.status).toBe(200)
    })
  })

  describe('setUser()', () => {
    it('sets user context', () => {
      const event = new WideEvent('test').setUser({
        did: 'did:plc:xyz',
        handle: 'test.bsky.social',
      })

      const data = event.toJSON()
      expect((data.user as Record<string, string>).did).toBe('did:plc:xyz')
      expect((data.user as Record<string, string>).handle).toBe(
        'test.bsky.social',
      )
    })

    it('sets user without optional handle', () => {
      const event = new WideEvent('test').setUser({
        did: 'did:plc:xyz',
      })

      const data = event.toJSON()
      expect((data.user as Record<string, string>).did).toBe('did:plc:xyz')
      expect((data.user as Record<string, string>).handle).toBeUndefined()
    })
  })

  describe('setError()', () => {
    it('sets error information', () => {
      const err = new Error('Something went wrong')
      err.name = 'ValidationError'

      const event = new WideEvent('test').setError(err)

      const data = event.toJSON()
      expect((data.error as Record<string, string>).message).toBe(
        'Something went wrong',
      )
      expect((data.error as Record<string, string>).name).toBe(
        'ValidationError',
      )
      expect((data.error as Record<string, string>).stack).toBeDefined()
    })
  })

  describe('setOutcome()', () => {
    it('sets outcome to success', () => {
      const event = new WideEvent('test').setOutcome('success')

      const data = event.toJSON()
      expect(data.outcome).toBe('success')
    })

    it('sets outcome to error', () => {
      const event = new WideEvent('test').setOutcome('error')

      const data = event.toJSON()
      expect(data.outcome).toBe('error')
    })

    it('sets outcome to ignored', () => {
      const event = new WideEvent('test').setOutcome('ignored')

      const data = event.toJSON()
      expect(data.outcome).toBe('ignored')
    })
  })

  describe('get()', () => {
    it('returns simple values', () => {
      const event = new WideEvent('test').set('method', 'POST')

      expect(event.get('method')).toBe('POST')
    })

    it('returns nested values', () => {
      const event = new WideEvent('test').set('user.did', 'did:plc:xyz')

      expect(event.get('user.did')).toBe('did:plc:xyz')
    })

    it('returns undefined for missing values', () => {
      const event = new WideEvent('test')

      expect(event.get('nonexistent')).toBeUndefined()
      expect(event.get('user.missing')).toBeUndefined()
    })
  })

  describe('toJSON()', () => {
    it('calculates duration_ms', () => {
      const event = new WideEvent('test')

      // Advance time by 100ms
      vi.advanceTimersByTime(100)

      const data = event.toJSON()
      expect(data.duration_ms).toBe(100)
    })
  })

  describe('emit()', () => {
    it('can be called without error', () => {
      const event = new WideEvent('test')
        .set('method', 'POST')
        .set('path', '/inbox')
        .setOutcome('success')

      expect(() => event.emit()).not.toThrow()
    })
  })
})

describe('createWideEvent()', () => {
  it('creates a new WideEvent', () => {
    const event = createWideEvent('http_request')

    expect(event).toBeInstanceOf(WideEvent)
    expect(event.get('type')).toBe('http_request')
  })
})
