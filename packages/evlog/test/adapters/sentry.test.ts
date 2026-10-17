import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from '../../src/types'
import { defined } from '../helpers/defined'
import { EVLOG_VERSION } from '../../src/shared/http'
import { sendBatchToSentry, sendToSentry, toSentryErrorEvent, toSentryLog, createSentryDrain } from '../../src/adapters/sentry'

describe('sentry adapter', () => {
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

  describe('toSentryLog', () => {
    it('converts timestamp to unix seconds', () => {
      const event = createTestEvent()
      const result = toSentryLog(event, { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.timestamp).toBe(new Date('2024-01-01T12:00:00.000Z').getTime() / 1000)
    })

    it('maps severity numbers correctly', () => {
      const levels = { debug: 5, info: 9, warn: 13, error: 17 } as const

      for (const [level, expectedSeverity] of Object.entries(levels)) {
        const event = createTestEvent({ level: level as WideEvent['level'] })
        const result = toSentryLog(event, { dsn: 'https://public@o0.ingest.sentry.io/123' })

        expect(result.severity_number).toBe(expectedSeverity)
        expect(result.level).toBe(level)
      }
    })

    it('keeps warn as warn (not warning)', () => {
      const event = createTestEvent({ level: 'warn' })
      const result = toSentryLog(event, { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.level).toBe('warn')
    })

    it('uses event message as body', () => {
      const event = createTestEvent({ message: 'Order created' })
      const result = toSentryLog(event, { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.body).toBe('Order created')
    })

    it('falls back to action then path for body', () => {
      const eventWithAction = createTestEvent({ action: 'checkout' })
      expect(toSentryLog(eventWithAction, { dsn: 'https://public@o0.ingest.sentry.io/123' }).body).toBe('checkout')

      const eventWithPath = createTestEvent({ path: '/api/users' })
      expect(toSentryLog(eventWithPath, { dsn: 'https://public@o0.ingest.sentry.io/123' }).body).toBe('/api/users')
    })

    it('uses default body when no message/action/path', () => {
      const event = createTestEvent()
      const result = toSentryLog(event, { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.body).toBe('evlog wide event')
    })

    it('generates a 32-char hex trace_id', () => {
      const event = createTestEvent()
      const result = toSentryLog(event, { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.trace_id).toMatch(/^[a-f0-9]{32}$/)
    })

    it('uses event traceId when available', () => {
      const event = createTestEvent({ traceId: 'abcdef1234567890abcdef1234567890' })
      const result = toSentryLog(event, { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.trace_id).toBe('abcdef1234567890abcdef1234567890')
    })

    it('includes service as typed attribute', () => {
      const event = createTestEvent()
      const result = toSentryLog(event, { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.attributes?.service).toEqual({ value: 'test-service', type: 'string' })
    })

    it('includes sentry.environment attribute', () => {
      const event = createTestEvent()
      const result = toSentryLog(event, { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.attributes?.['sentry.environment']).toEqual({ value: 'test', type: 'string' })
    })

    it('uses config environment over event environment', () => {
      const event = createTestEvent({ environment: 'staging' })
      const result = toSentryLog(event, {
        dsn: 'https://public@o0.ingest.sentry.io/123',
        environment: 'production',
      })

      expect(result.attributes?.['sentry.environment']).toEqual({ value: 'production', type: 'string' })
    })

    it('types attributes correctly', () => {
      const event = createTestEvent({
        requestId: 'req-123',
        duration: 234,
        ratio: 0.75,
        success: true,
        nested: { key: 'value' },
      })
      const result = toSentryLog(event, { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.attributes?.requestId).toEqual({ value: 'req-123', type: 'string' })
      expect(result.attributes?.duration).toEqual({ value: 234, type: 'integer' })
      expect(result.attributes?.ratio).toEqual({ value: 0.75, type: 'double' })
      expect(result.attributes?.success).toEqual({ value: true, type: 'boolean' })
      expect(result.attributes?.nested).toEqual({ value: '{"key":"value"}', type: 'string' })
    })

    it('includes custom tags from config as attributes', () => {
      const event = createTestEvent()
      const result = toSentryLog(event, {
        dsn: 'https://public@o0.ingest.sentry.io/123',
        tags: { team: 'backend', region: 'eu' },
      })

      expect(result.attributes?.team).toEqual({ value: 'backend', type: 'string' })
      expect(result.attributes?.region).toEqual({ value: 'eu', type: 'string' })
    })

    it('excludes traceId and spanId from attributes', () => {
      const event = createTestEvent({ traceId: 'abc123', spanId: 'def456' })
      const result = toSentryLog(event, { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.attributes?.traceId).toBeUndefined()
      expect(result.attributes?.spanId).toBeUndefined()
    })

    it('attaches the SDK identity to every log', () => {
      const result = toSentryLog(createTestEvent(), { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.attributes?.['sentry.sdk.name']).toEqual({ value: 'evlog', type: 'string' })
      expect(result.attributes?.['sentry.sdk.version']).toEqual({ value: EVLOG_VERSION, type: 'string' })
    })

    it('sets span_id from the event span', () => {
      const result = toSentryLog(createTestEvent({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }), { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result.span_id).toBe('b'.repeat(16))
    })

    it('omits span_id when the event has no span', () => {
      const result = toSentryLog(createTestEvent(), { dsn: 'https://public@o0.ingest.sentry.io/123' })

      expect(result).not.toHaveProperty('span_id')
    })
  })

  describe('sendToSentry', () => {
    it('sends log to correct Sentry envelope URL', async () => {
      const event = createTestEvent()

      await sendToSentry(event, {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://o123.ingest.sentry.io/api/456/envelope/')
    })

    it('supports DSNs with path prefixes', async () => {
      const event = createTestEvent()

      await sendToSentry(event, {
        dsn: 'https://public@localhost:8080/sentry/456',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://localhost:8080/sentry/api/456/envelope/')
    })

    it('sets Sentry auth header', async () => {
      const event = createTestEvent()

      await sendToSentry(event, {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        'X-Sentry-Auth': expect.stringContaining('sentry_key=public'),
      }))
    })

    it('sets Content-Type to application/x-sentry-envelope', async () => {
      const event = createTestEvent()

      await sendToSentry(event, {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        'Content-Type': 'application/x-sentry-envelope',
      }))
    })

    it('sends valid log envelope payload', async () => {
      const event = createTestEvent({ level: 'error', message: 'boom' })

      await sendToSentry(event, {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const lines = (options.body as string).split('\n').filter(line => line.length > 0)

      const envelopeHeader = JSON.parse(lines[0])
      expect(envelopeHeader.dsn).toBe('https://public@o123.ingest.sentry.io/456')
      expect(envelopeHeader.sent_at).toBeDefined()

      const itemHeader = JSON.parse(lines[1])
      expect(itemHeader.type).toBe('log')
      expect(itemHeader.item_count).toBe(1)
      expect(itemHeader.content_type).toBe('application/vnd.sentry.items.log+json')

      const itemPayload = JSON.parse(lines[2])
      expect(itemPayload.items).toHaveLength(1)

      const [log] = itemPayload.items
      expect(log.level).toBe('error')
      expect(log.severity_number).toBe(17)
      expect(log.body).toBe('boom')
      expect(log.trace_id).toMatch(/^[a-f0-9]{32}$/)
      expect(log.timestamp).toBeGreaterThan(0)
    })

    it('identifies the SDK in the envelope header', async () => {
      await sendToSentry(createTestEvent({ level: 'info' }), {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const envelopeHeader = JSON.parse(String(options.body).split('\n')[0] ?? '')
      expect(envelopeHeader.sdk).toEqual({ name: 'evlog', version: EVLOG_VERSION })
    })

    it('throws error on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Bad Request', { status: 400, statusText: 'Bad Request' }),
      )

      const event = createTestEvent()

      await expect(sendToSentry(event, {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      })).rejects.toThrow('Sentry API error: 400 Bad Request')
    })
  })

  describe('sendBatchToSentry', () => {
    it('sends multiple logs in a single request', async () => {
      const events = [
        createTestEvent({ requestId: '1' }),
        createTestEvent({ requestId: '2' }),
        createTestEvent({ requestId: '3' }),
      ]

      await sendBatchToSentry(events, {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const lines = (options.body as string).split('\n').filter(line => line.length > 0)

      const itemHeader = JSON.parse(lines[1])
      expect(itemHeader.item_count).toBe(3)

      const itemPayload = JSON.parse(lines[2])
      expect(itemPayload.items).toHaveLength(3)
    })

    it('splits more than 100 logs into several envelopes', async () => {
      const events = Array.from({ length: 250 }, (_, index) => createTestEvent({ requestId: String(index) }))

      await sendBatchToSentry(events, {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      })

      const counts = fetchSpy.mock.calls.map((call) => {
        const [, options] = call as [string, RequestInit]
        const lines = (options.body as string).split('\n').filter(line => line.length > 0)
        return JSON.parse(lines[1]).item_count
      })
      expect(counts).toEqual([100, 100, 50])
    })

    it('does not send request for empty events array', async () => {
      await sendBatchToSentry([], {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      })

      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('timeout handling', () => {
    it('uses default timeout of 5000ms', async () => {
      const event = createTestEvent()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      await sendToSentry(event, {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      })

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
    })

    it('uses custom timeout when provided', async () => {
      const event = createTestEvent()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      await sendToSentry(event, {
        dsn: 'https://public@o123.ingest.sentry.io/456',
        timeout: 10000,
      })

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000)
    })
  })

  describe('issues', () => {
    const dsn = 'https://public@o0.ingest.sentry.io/123'
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'

    function envelopes() {
      return fetchSpy.mock.calls.map((call) => {
        const [, init] = call as [string, RequestInit]
        const [header, item, payload] = String(init.body).split('\n')
        return { header: JSON.parse(header ?? ''), item: JSON.parse(item ?? ''), payload: JSON.parse(payload ?? '') }
      })
    }

    it('identifies the SDK in the error event envelope header', async () => {
      await sendBatchToSentry([createTestEvent({ level: 'error', traceId, error: { name: 'Error', message: 'boom' } })], { dsn, issues: true })

      const issue = envelopes().find(e => e.item.type === 'event')
      expect(defined(issue, 'issue envelope').header.sdk).toEqual({ name: 'evlog', version: EVLOG_VERSION })
    })

    it('maps an error wide event to a Sentry error event in its trace', () => {
      const result = toSentryErrorEvent(createTestEvent({
        level: 'error',
        method: 'POST',
        path: '/api/checkout',
        traceId,
        spanId: '00f067aa0ba902b7',
        parentSpanId: 'b7ad6b7169203331',
        version: '1.2.0',
        error: { name: 'PaymentError', message: 'Card declined' },
      }), { dsn, tags: { team: 'payments' } })

      expect(result).toMatchObject({
        level: 'error',
        logger: 'evlog',
        environment: 'test',
        release: '1.2.0',
        transaction: 'POST /api/checkout',
        exception: { values: [{ type: 'PaymentError', value: 'Card declined' }] },
        contexts: { trace: { trace_id: traceId, span_id: '00f067aa0ba902b7', parent_span_id: 'b7ad6b7169203331' } },
        tags: { service: 'test-service', team: 'payments' },
      })
      expect(result.event_id).toMatch(/^[a-f0-9]{32}$/)
    })

    it('sends only the log envelope when issues are off', async () => {
      await sendBatchToSentry([createTestEvent({ level: 'error', traceId })], { dsn })

      expect(envelopes().map(e => e.item.type)).toEqual(['log'])
    })

    it('opens an issue for error and fatal events, sharing the log trace id', async () => {
      await sendBatchToSentry([
        createTestEvent({ level: 'info', traceId: 'a'.repeat(32) }),
        createTestEvent({ level: 'error', traceId, error: { name: 'Error', message: 'boom' } }),
        createTestEvent({ level: 'fatal' }),
      ], { dsn, issues: true })

      const [logs, ...issues] = envelopes()
      expect(defined(logs, 'log envelope').item.type).toBe('log')
      expect(issues.map(e => e.item.type)).toEqual(['event', 'event'])
      const [errorIssue, fatalIssue] = issues.map(e => e.payload)
      expect(errorIssue.contexts.trace.trace_id).toBe(traceId)
      expect(logs?.payload.items[1].trace_id).toBe(traceId)
      expect(fatalIssue.level).toBe('fatal')
      expect(fatalIssue.contexts.trace.trace_id).toBe(logs?.payload.items[2].trace_id)
      expect(issues[0]?.header.event_id).toBe(errorIssue.event_id)
    })

    it('resends a retried batch with the same issue event id and trace id', async () => {
      const batch = [createTestEvent({ level: 'error' })]
      await sendBatchToSentry(batch, { dsn, issues: true })
      await sendBatchToSentry(batch, { dsn, issues: true })

      const [firstLogs, firstIssue, retryLogs, retryIssue] = envelopes()
      expect(retryIssue?.payload.event_id).toBe(firstIssue?.payload.event_id)
      expect(retryIssue?.payload.contexts.trace.trace_id).toBe(firstIssue?.payload.contexts.trace.trace_id)
      expect(retryIssue?.payload.contexts.trace.span_id).toBe(firstIssue?.payload.contexts.trace.span_id)
      expect(retryLogs?.payload.items[0].trace_id).toBe(firstLogs?.payload.items[0].trace_id)
    })

    it('reads `status` before the legacy `statusCode` when they disagree', async () => {
      await sendBatchToSentry([
        createTestEvent({ level: 'error', error: { name: 'EvlogError', message: 'User 8231 not found', status: 404, statusCode: 500 } }),
        createTestEvent({ level: 'error', error: { name: 'EvlogError', message: 'Database down', status: 503 } }),
      ], { dsn, issues: true })

      const [, ...issues] = envelopes()
      expect(issues.map(e => e.payload.exception.values[0].value)).toEqual(['Database down'])
    })

    it('does not open issues for 4xx errors', async () => {
      await sendBatchToSentry([
        createTestEvent({ level: 'error', status: 404, error: { name: 'EvlogError', message: 'User 8231 not found', status: 404 } }),
        createTestEvent({ level: 'error', error: { name: 'H3Error', message: 'Unauthorized', statusCode: 401 } }),
        createTestEvent({ level: 'error', status: 400, error: { name: 'Error', message: 'Invalid body' } }),
        createTestEvent({ level: 'error', status: 500, error: { name: 'TypeError', message: 'boom' } }),
        createTestEvent({ level: 'error', error: { name: 'Error', message: 'job failed' } }),
      ], { dsn, issues: true })

      const [logs, ...issues] = envelopes()
      expect(logs?.payload.items).toHaveLength(5)
      expect(issues.map(e => e.payload.exception.values[0].value)).toEqual(['boom', 'job failed'])
    })

    it('sends the error stack as frames, oldest call first', () => {
      const stack = [
        'TypeError: Cannot read properties of undefined',
        '    at getUser (/app/server/api/user.ts:12:5)',
        '    at async handler (/app/server/api/user.ts:30:3)',
        '    at callHandler (/app/node_modules/h3/dist/index.mjs:100:9)',
      ].join('\n')
      const result = toSentryErrorEvent(createTestEvent({ level: 'error', error: { name: 'TypeError', message: 'x', stack } }), { dsn })

      expect(result.exception.values[0]?.stacktrace?.frames).toEqual([
        { filename: '/app/node_modules/h3/dist/index.mjs', abs_path: '/app/node_modules/h3/dist/index.mjs', function: 'callHandler', lineno: 100, colno: 9, in_app: false },
        { filename: '/app/server/api/user.ts', abs_path: '/app/server/api/user.ts', function: 'async handler', lineno: 30, colno: 3, in_app: true },
        { filename: '/app/server/api/user.ts', abs_path: '/app/server/api/user.ts', function: 'getUser', lineno: 12, colno: 5, in_app: true },
      ])
      expect(result.fingerprint).toBeUndefined()
    })

    it('groups a stackless error by type and transaction, not by message', () => {
      const result = toSentryErrorEvent(createTestEvent({
        level: 'error',
        method: 'GET',
        path: '/api/users/8231',
        error: { name: 'NotFoundError', message: 'User 8231 not found' },
      }), { dsn })

      expect(result.exception.values[0]?.stacktrace).toBeUndefined()
      expect(result.fingerprint).toEqual(['NotFoundError', 'GET /api/users/8231'])
    })

    it('attaches the user id', () => {
      expect(toSentryErrorEvent(createTestEvent({ level: 'error', userId: 'u_1' }), { dsn }).user).toEqual({ id: 'u_1' })
      expect(toSentryErrorEvent(createTestEvent({ level: 'error', user: { id: 'u_2' } }), { dsn }).user).toEqual({ id: 'u_2' })
      expect(toSentryErrorEvent(createTestEvent({ level: 'error' }), { dsn }).user).toBeUndefined()
    })

    it('resolves when an issue request fails, so a batch retry does not resend the logs', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      fetchSpy
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response('Too Many Requests', { status: 429, statusText: 'Too Many Requests' }))

      await expect(sendBatchToSentry([
        createTestEvent({ level: 'error', error: { name: 'Error', message: 'first' } }),
        createTestEvent({ level: 'error', error: { name: 'Error', message: 'second' } }),
      ], { dsn, issues: true, retries: 0 })).resolves.toBeUndefined()

      expect(envelopes().map(e => e.item.type)).toEqual(['log', 'event'])
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('skipped 1 more'), expect.any(Error))
    })

    it('rejects without sending issues when the log request fails', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }))

      await expect(sendBatchToSentry([createTestEvent({ level: 'error' })], { dsn, issues: true, retries: 0 }))
        .rejects.toThrow('Sentry API error: 502')
      expect(fetchSpy).toHaveBeenCalledOnce()
    })

    it('sends issue requests one at a time', async () => {
      const inFlight: Array<() => void> = []
      fetchSpy.mockImplementation(() => new Promise<Response>((resolve) => {
        inFlight.push(() => resolve(new Response(null, { status: 200 })))
      }))

      const sending = sendBatchToSentry(Array.from({ length: 5 }, () => createTestEvent({ level: 'error' })), { dsn, issues: true })
      for (let call = 0; call < 6; call++) {
        await vi.waitFor(() => expect(inFlight).toHaveLength(1))
        defined(inFlight.shift(), 'pending request')()
      }
      await sending

      expect(fetchSpy).toHaveBeenCalledTimes(6)
    })

    it('reads issues from the drain config', async () => {
      const drain = createSentryDrain({ dsn, issues: true })
      await drain({ event: createTestEvent({ level: 'error', traceId }) })

      expect(envelopes().map(e => e.item.type)).toEqual(['log', 'event'])
    })
  })

  describe('createSentryDrain', () => {
    const createDrainContext = (overrides?: Partial<WideEvent>) => ({
      event: createTestEvent(overrides),
      request: { method: 'GET', path: '/', requestId: 'r1' },
      headers: {},
    })

    let origNuxtSentryDsn: string | undefined
    let origSentryDsn: string | undefined

    beforeEach(() => {
      origNuxtSentryDsn = process.env.NUXT_SENTRY_DSN
      origSentryDsn = process.env.SENTRY_DSN
      delete process.env.NUXT_SENTRY_DSN
      delete process.env.SENTRY_DSN
    })

    afterEach(() => {
      if (origNuxtSentryDsn === undefined) delete process.env.NUXT_SENTRY_DSN
      else process.env.NUXT_SENTRY_DSN = origNuxtSentryDsn
      if (origSentryDsn === undefined) delete process.env.SENTRY_DSN
      else process.env.SENTRY_DSN = origSentryDsn
    })

    it('returns a callable drain that posts events', async () => {
      const drain = createSentryDrain({ dsn: 'https://public@o123.ingest.sentry.io/456' })
      await drain(createDrainContext())
      expect(fetchSpy).toHaveBeenCalledOnce()
    })

    it('logs error and skips fetch when dsn is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const drain = createSentryDrain()
      await drain(createDrainContext())
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[evlog/sentry] Missing DSN'),
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
