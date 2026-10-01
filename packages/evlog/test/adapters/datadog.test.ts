import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from '../../src/types'
import {
  formatDatadogMessageLine,
  resolveDatadogIntakeUrl,
  resolveDatadogLogStatus,
  resolveDatadogTraceContext,
  sanitizeWideEventForDatadog,
  sendBatchToDatadog,
  sendToDatadog,
  toDatadogLog,
  createDatadogDrain,
} from '../../src/adapters/datadog'

describe('datadog adapter', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
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

  describe('resolveDatadogIntakeUrl', () => {
    it('uses default US1 site when not configured', () => {
      expect(resolveDatadogIntakeUrl({})).toBe('https://http-intake.logs.datadoghq.com/api/v2/logs')
    })

    it('respects custom site', () => {
      expect(resolveDatadogIntakeUrl({ site: 'datadoghq.eu' })).toBe(
        'https://http-intake.logs.datadoghq.eu/api/v2/logs',
      )
    })

    it('uses intakeUrl when set', () => {
      expect(
        resolveDatadogIntakeUrl({
          intakeUrl: 'https://custom.example.com/api/v2/logs/',
        }),
      ).toBe('https://custom.example.com/api/v2/logs')
    })
  })

  describe('resolveDatadogLogStatus', () => {
    it('uses wide event level when set', () => {
      expect(resolveDatadogLogStatus(createTestEvent({ level: 'error' }))).toBe('error')
      expect(resolveDatadogLogStatus(createTestEvent({ level: 'warn' }))).toBe('warn')
      expect(resolveDatadogLogStatus(createTestEvent({ level: 'debug' }))).toBe('debug')
    })

    it('maps fatal to error and trace to debug', () => {
      expect(resolveDatadogLogStatus(createTestEvent({ level: 'fatal' }))).toBe('error')
      expect(resolveDatadogLogStatus(createTestEvent({ level: 'trace' }))).toBe('debug')
    })

    it('maps HTTP 5xx to error when level is still info', () => {
      expect(resolveDatadogLogStatus(createTestEvent({ status: 503 }))).toBe('error')
    })

    it('maps HTTP 4xx to warn when level is still info', () => {
      expect(resolveDatadogLogStatus(createTestEvent({ status: 402 }))).toBe('warn')
    })

    it('keeps explicit error level even when HTTP status is 2xx', () => {
      expect(resolveDatadogLogStatus(createTestEvent({ level: 'error', status: 200 }))).toBe('error')
    })

    it('keeps warn level over HTTP 5xx', () => {
      expect(resolveDatadogLogStatus(createTestEvent({ level: 'warn', status: 503 }))).toBe('warn')
    })
  })

  describe('sanitizeWideEventForDatadog', () => {
    it('renames top-level numeric status so Datadog attributes do not clobber log severity', () => {
      const event = createTestEvent({ status: 400, level: 'error', path: '/api/pay' })
      const parsed = sanitizeWideEventForDatadog(event)

      expect(parsed.status).toBeUndefined()
      expect(parsed.httpStatusCode).toBe(400)
      expect(parsed.level).toBe('error')
    })

    it('renames nested error.status (e.g. EvlogError) the same way', () => {
      const event = createTestEvent({
        level: 'error',
        status: 400,
        error: {
          name: 'EvlogError',
          message: 'Payment processing failed',
          status: 400,
          data: { why: 'Card declined' },
        },
      })
      const parsed = sanitizeWideEventForDatadog(event)

      expect(parsed.status).toBeUndefined()
      expect(parsed.httpStatusCode).toBe(400)
      const err = parsed.error as Record<string, unknown>
      expect(err.status).toBeUndefined()
      expect(err.httpStatusCode).toBe(400)
    })

    it('omits httpStatusCode when HTTP status is absent', () => {
      const event = createTestEvent({ path: '/ok' })
      const parsed = sanitizeWideEventForDatadog(event)

      expect(parsed.httpStatusCode).toBeUndefined()
      expect(parsed.path).toBe('/ok')
    })

    it('does not mutate the original wide event', () => {
      const event = createTestEvent({
        status: 418,
        error: { name: 'E', message: 'm', status: 418 },
      })
      sanitizeWideEventForDatadog(event)
      expect(event.status).toBe(418)
      expect((event.error as Record<string, unknown>).status).toBe(418)
    })
  })

  describe('resolveDatadogTraceContext', () => {
    it('maps traceId and spanId to Datadog reserved names', () => {
      expect(resolveDatadogTraceContext(createTestEvent({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
      }))).toEqual({
        trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
        span_id: '00f067aa0ba902b7',
      })
    })

    it('keeps whichever id is present on its own', () => {
      expect(resolveDatadogTraceContext(createTestEvent({ traceId: 'abc' }))).toEqual({ trace_id: 'abc' })
      expect(resolveDatadogTraceContext(createTestEvent({ spanId: 'def' }))).toEqual({ span_id: 'def' })
    })

    it('returns undefined without trace context', () => {
      expect(resolveDatadogTraceContext(createTestEvent())).toBeUndefined()
    })

    it('ignores empty and non-string ids', () => {
      expect(resolveDatadogTraceContext(createTestEvent({ traceId: '', spanId: '' }))).toBeUndefined()
      expect(resolveDatadogTraceContext(createTestEvent({ traceId: 123, spanId: null }))).toBeUndefined()
    })
  })

  describe('formatDatadogMessageLine', () => {
    it('includes level, method, path, and status code', () => {
      const line = formatDatadogMessageLine(
        createTestEvent({ method: 'GET', path: '/api/x', status: 400, level: 'warn' }),
      )
      expect(line).toBe('WARN GET /api/x (400)')
    })

    it('falls back to service when method and path are missing', () => {
      expect(formatDatadogMessageLine(createTestEvent())).toBe('INFO test-service')
    })

    it('falls back to the level alone when there is no service either', () => {
      expect(formatDatadogMessageLine(createTestEvent({ service: '' }))).toBe('INFO')
    })
  })

  describe('toDatadogLog', () => {
    it('maps wide event fields for Datadog Logs v2', () => {
      const event = createTestEvent({ path: '/api/hello', userId: 'u1', method: 'POST' })
      const row = toDatadogLog(event)

      expect(row.service).toBe('test-service')
      expect(row.status).toBe('info')
      expect(row.ddsource).toBe('evlog')
      expect(row.ddtags).toBe('env:test')
      expect(row.timestamp).toBe(Date.parse('2024-01-01T12:00:00.000Z'))
      expect(row.message).toBe('INFO POST /api/hello')
      expect(row.evlog).toMatchObject({
        timestamp: '2024-01-01T12:00:00.000Z',
        level: 'info',
        service: 'test-service',
        environment: 'test',
        path: '/api/hello',
        userId: 'u1',
      })
    })

    it('lifts trace context to a root dd block while keeping the nested copy', () => {
      const event = createTestEvent({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
      })
      const row = toDatadogLog(event)

      expect(row.dd).toEqual({
        trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
        span_id: '00f067aa0ba902b7',
      })
      expect(row.evlog).toMatchObject({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
      })
    })

    it('omits dd when the event carries no trace context', () => {
      const row = toDatadogLog(createTestEvent({ path: '/api/hello' }))
      expect(row).not.toHaveProperty('dd')
    })

    it('adds version to tags when present', () => {
      const event = createTestEvent({ version: '1.2.3' })
      const row = toDatadogLog(event)
      expect(row.ddtags).toBe('env:test,version:1.2.3')
    })

    it('sets intake status to error and keeps HTTP code only as httpStatusCode inside evlog', () => {
      const event = createTestEvent({
        level: 'error',
        status: 400,
        path: '/api/test/error',
        method: 'GET',
        errorCode: 'card_declined',
      })
      const row = toDatadogLog(event)

      expect(row.status).toBe('error')
      expect(row.message).toBe('ERROR GET /api/test/error (400)')
      const evlog = row.evlog as Record<string, unknown>
      expect(evlog.status).toBeUndefined()
      expect(evlog.httpStatusCode).toBe(400)
      expect(evlog.level).toBe('error')
    })
  })

  describe('sendToDatadog', () => {
    it('posts to default intake URL', async () => {
      const event = createTestEvent()

      await sendToDatadog(event, {
        apiKey: 'test-key',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://http-intake.logs.datadoghq.com/api/v2/logs')
    })

    it('uses custom site in URL', async () => {
      const event = createTestEvent()

      await sendToDatadog(event, {
        apiKey: 'test-key',
        site: 'us3.datadoghq.com',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://http-intake.logs.us3.datadoghq.com/api/v2/logs')
    })

    it('uses intakeUrl when provided', async () => {
      const event = createTestEvent()

      await sendToDatadog(event, {
        apiKey: 'test-key',
        intakeUrl: 'https://http-intake.logs.ap1.datadoghq.com/api/v2/logs',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://http-intake.logs.ap1.datadoghq.com/api/v2/logs')
    })

    it('sets DD-API-KEY header', async () => {
      const event = createTestEvent()

      await sendToDatadog(event, {
        apiKey: 'dd-secret',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        'DD-API-KEY': 'dd-secret',
        'Content-Type': 'application/json',
      }))
    })

    it('sends JSON array body with summary message and evlog payload', async () => {
      const event = createTestEvent({ action: 'ping', method: 'GET', path: '/p' })

      await sendToDatadog(event, {
        apiKey: 'test-key',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(options.body as string)
      expect(body).toHaveLength(1)
      expect(body[0].service).toBe('test-service')
      expect(body[0].ddsource).toBe('evlog')
      expect(body[0].message).toBe('INFO GET /p')
      expect(body[0].evlog).toMatchObject({ action: 'ping' })
    })

    it('throws on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Forbidden', { status: 403, statusText: 'Forbidden' }),
      )

      const event = createTestEvent()

      await expect(
        sendToDatadog(event, { apiKey: 'test-key' }),
      ).rejects.toThrow('Datadog API error: 403 Forbidden')
    })
  })

  describe('sendBatchToDatadog', () => {
    it('sends multiple events in one request', async () => {
      const events = [
        createTestEvent({ requestId: '1' }),
        createTestEvent({ requestId: '2' }),
      ]

      await sendBatchToDatadog(events, { apiKey: 'test-key' })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(options.body as string)
      expect(body).toHaveLength(2)
    })

    it('skips fetch when events array is empty', async () => {
      await sendBatchToDatadog([], { apiKey: 'test-key' })

      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('timeout handling', () => {
    it('uses default timeout of 5000ms', async () => {
      const event = createTestEvent()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      await sendToDatadog(event, {
        apiKey: 'test-key',
      })

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
    })

    it('uses custom timeout when provided', async () => {
      const event = createTestEvent()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      await sendToDatadog(event, {
        apiKey: 'test-key',
        timeout: 12000,
      })

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 12000)
    })
  })

  describe('createDatadogDrain', () => {
    const createDrainContext = (overrides?: Partial<WideEvent>) => ({
      event: createTestEvent(overrides),
      request: { method: 'GET', path: '/', requestId: 'r1' },
      headers: {},
    })

    let origNuxtDatadogApiKey: string | undefined
    let origDatadogApiKey: string | undefined
    let origDdApiKey: string | undefined

    beforeEach(() => {
      origNuxtDatadogApiKey = process.env.NUXT_DATADOG_API_KEY
      origDatadogApiKey = process.env.DATADOG_API_KEY
      origDdApiKey = process.env.DD_API_KEY
      delete process.env.NUXT_DATADOG_API_KEY
      delete process.env.DATADOG_API_KEY
      delete process.env.DD_API_KEY
    })

    afterEach(() => {
      if (origNuxtDatadogApiKey === undefined) delete process.env.NUXT_DATADOG_API_KEY
      else process.env.NUXT_DATADOG_API_KEY = origNuxtDatadogApiKey
      if (origDatadogApiKey === undefined) delete process.env.DATADOG_API_KEY
      else process.env.DATADOG_API_KEY = origDatadogApiKey
      if (origDdApiKey === undefined) delete process.env.DD_API_KEY
      else process.env.DD_API_KEY = origDdApiKey
    })

    it('returns a callable drain that posts events', async () => {
      const drain = createDatadogDrain({ apiKey: 'dd-key' })
      await drain(createDrainContext())
      expect(fetchSpy).toHaveBeenCalledOnce()
    })

    it('logs error and skips fetch when apiKey is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const drain = createDatadogDrain()
      await drain(createDrainContext())
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[evlog/datadog] Missing API key'),
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
