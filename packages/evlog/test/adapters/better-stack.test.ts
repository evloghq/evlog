import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from '../../src/types'
import { sendBatchToBetterStack, sendToBetterStack, toBetterStackEvent, createBetterStackDrain } from '../../src/adapters/better-stack'
import { enableDeprecationWarnings } from '../helpers/deprecations'

describe('better-stack adapter', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 202 }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createTestEvent = (overrides?: Partial<WideEvent>): WideEvent => ({
    timestamp: '2024-01-01T12:00:00.000Z',
    level: 'info',
    service: 'test-service',
    environment: 'test',
    ...overrides,
  })

  describe('toBetterStackEvent', () => {
    it('maps timestamp to dt', () => {
      const event = createTestEvent()
      const result = toBetterStackEvent(event)

      expect(result.dt).toBe('2024-01-01T12:00:00.000Z')
      expect(result.timestamp).toBeUndefined()
    })

    it('preserves all other fields', () => {
      const event = createTestEvent({ action: 'test-action', userId: '123' })
      const result = toBetterStackEvent(event)

      expect(result.dt).toBe('2024-01-01T12:00:00.000Z')
      expect(result.level).toBe('info')
      expect(result.service).toBe('test-service')
      expect(result.environment).toBe('test')
      expect(result.action).toBe('test-action')
      expect(result.userId).toBe('123')
    })
  })

  describe('sendToBetterStack', () => {
    it('sends event to default Better Stack endpoint', async () => {
      const event = createTestEvent()

      await sendToBetterStack(event, {
        apiKey: 'test-token',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://in.logs.betterstack.com')
    })

    it('uses custom endpoint when provided', async () => {
      const event = createTestEvent()

      await sendToBetterStack(event, {
        apiKey: 'test-token',
        endpoint: 'https://custom.betterstack.com',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://custom.betterstack.com')
    })

    it('strips trailing slash from endpoint', async () => {
      const event = createTestEvent()

      await sendToBetterStack(event, {
        apiKey: 'test-token',
        endpoint: 'https://custom.betterstack.com/',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://custom.betterstack.com')
    })

    it('sets correct Authorization header with Bearer token', async () => {
      const event = createTestEvent()

      await sendToBetterStack(event, {
        apiKey: 'my-secret-token',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        'Authorization': 'Bearer my-secret-token',
      }))
    })

    it('sets Content-Type to application/json', async () => {
      const event = createTestEvent()

      await sendToBetterStack(event, {
        apiKey: 'test-token',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        'Content-Type': 'application/json',
      }))
    })

    it('sends transformed events with dt field in body', async () => {
      const event = createTestEvent({ action: 'test-action', userId: '123' })

      await sendToBetterStack(event, {
        apiKey: 'test-token',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(options.body as string)
      expect(body).toEqual([
        {
          dt: '2024-01-01T12:00:00.000Z',
          level: 'info',
          service: 'test-service',
          environment: 'test',
          action: 'test-action',
          userId: '123',
        }
      ])
    })

    it('throws error on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Bad Request', { status: 400, statusText: 'Bad Request' }),
      )

      const event = createTestEvent()

      await expect(sendToBetterStack(event, {
        apiKey: 'test-token',
      })).rejects.toThrow('Better Stack API error: 400 Bad Request')
    })
  })

  describe('sendBatchToBetterStack', () => {
    it('sends multiple events in a single request', async () => {
      const events = [
        createTestEvent({ requestId: '1' }),
        createTestEvent({ requestId: '2' }),
        createTestEvent({ requestId: '3' }),
      ]

      await sendBatchToBetterStack(events, {
        apiKey: 'test-token',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(options.body as string)
      expect(body).toHaveLength(3)
      expect(body[0].dt).toBe('2024-01-01T12:00:00.000Z')
      expect(body[0].requestId).toBe('1')
    })

    it('sends empty array when no events', async () => {
      await sendBatchToBetterStack([], {
        apiKey: 'test-token',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(options.body as string)
      expect(body).toEqual([])
    })
  })

  describe('timeout handling', () => {
    it('uses default timeout of 5000ms', async () => {
      const event = createTestEvent()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      await sendToBetterStack(event, {
        apiKey: 'test-token',
      })

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
    })

    it('uses custom timeout when provided', async () => {
      const event = createTestEvent()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      await sendToBetterStack(event, {
        apiKey: 'test-token',
        timeout: 10000,
      })

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000)
    })
  })

  describe('createBetterStackDrain', () => {
    const createDrainContext = (overrides?: Partial<WideEvent>) => ({
      event: createTestEvent(overrides),
      request: { method: 'GET', path: '/', requestId: 'r1' },
      headers: {},
    })

    beforeEach(enableDeprecationWarnings)

    afterEach(() => {
      vi.unstubAllEnvs()
      delete process.env.NUXT_BETTER_STACK_API_KEY
      delete process.env.BETTER_STACK_API_KEY
      delete process.env.NUXT_BETTER_STACK_SOURCE_TOKEN
      delete process.env.BETTER_STACK_SOURCE_TOKEN
    })

    it('returns a callable drain that posts events', async () => {
      const drain = createBetterStackDrain({ apiKey: 'test-key' })
      await drain(createDrainContext())
      expect(fetchSpy).toHaveBeenCalledOnce()
    })

    it('logs error and skips fetch when apiKey is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const drain = createBetterStackDrain()
      await drain(createDrainContext())
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Set BETTER_STACK_API_KEY env var'),
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('warns when legacy sourceToken alias is used', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const drain = createBetterStackDrain({ sourceToken: 'legacy-key' })
      await drain(createDrainContext())
      expect(warnSpy).toHaveBeenCalledWith(
        '[evlog/better-stack] \'sourceToken\' is deprecated and removed in v3, use \'apiKey\' instead.',
      )
    })

    it('accepts legacy sourceToken alias', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const drain = createBetterStackDrain({ sourceToken: 'legacy-key' })
      await drain(createDrainContext())
      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        Authorization: 'Bearer legacy-key',
      }))
    })
  })
})
