import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from '../../src/types'
import { sendBatchToOTLP, sendToOTLP, toOTLPLogRecord, createOTLPDrain } from '../../src/adapters/otlp'

describe('otlp adapter', () => {
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

  describe('toOTLPLogRecord', () => {
    it('converts timestamp to nanoseconds', () => {
      const event = createTestEvent({ timestamp: '2024-01-01T12:00:00.000Z' })
      const record = toOTLPLogRecord(event)

      const expectedNanos = new Date('2024-01-01T12:00:00.000Z').getTime() * 1_000_000
      expect(record.timeUnixNano).toBe(String(expectedNanos))
    })

    it('maps debug level to severity 5', () => {
      const event = createTestEvent({ level: 'debug' })
      const record = toOTLPLogRecord(event)

      expect(record.severityNumber).toBe(5)
      expect(record.severityText).toBe('DEBUG')
    })

    it('maps info level to severity 9', () => {
      const event = createTestEvent({ level: 'info' })
      const record = toOTLPLogRecord(event)

      expect(record.severityNumber).toBe(9)
      expect(record.severityText).toBe('INFO')
    })

    it('maps warn level to severity 13', () => {
      const event = createTestEvent({ level: 'warn' })
      const record = toOTLPLogRecord(event)

      expect(record.severityNumber).toBe(13)
      expect(record.severityText).toBe('WARN')
    })

    it('maps error level to severity 17', () => {
      const event = createTestEvent({ level: 'error' })
      const record = toOTLPLogRecord(event)

      expect(record.severityNumber).toBe(17)
      expect(record.severityText).toBe('ERROR')
    })

    it('maps fatal level to severity 21', () => {
      const event = createTestEvent({ level: 'fatal' })
      const record = toOTLPLogRecord(event)

      expect(record.severityNumber).toBe(21)
      expect(record.severityText).toBe('FATAL')
    })

    it('maps trace level to severity 1', () => {
      const event = createTestEvent({ level: 'trace' })
      const record = toOTLPLogRecord(event)

      expect(record.severityNumber).toBe(1)
      expect(record.severityText).toBe('TRACE')
    })

    it('serializes the whole event as the body by default', () => {
      const event = createTestEvent({ action: 'test', userId: '123' })
      const record = toOTLPLogRecord(event)

      expect(record.body.stringValue).toBe(JSON.stringify(event))
    })

    it('summarizes the request in the body in compact shape', () => {
      const event = createTestEvent({ method: 'POST', path: '/api/checkout', status: 500 })
      const record = toOTLPLogRecord(event, 'compact')

      expect(record.body.stringValue).toBe('POST /api/checkout (500)')
    })

    it('falls back to the service name when the event has no request shape', () => {
      const event = createTestEvent({ action: 'test' })
      const record = toOTLPLogRecord(event, 'compact')

      expect(record.body.stringValue).toBe('test-service')
    })

    it('keeps event fields out of the body and in the attributes in compact shape', () => {
      const event = createTestEvent({ method: 'GET', path: '/api/me', userId: 'usr_123' })
      const record = toOTLPLogRecord(event, 'compact')

      expect(record.body.stringValue).not.toContain('usr_123')
      expect(record.attributes.find(a => a.key === 'userId')?.value).toEqual({ stringValue: 'usr_123' })
    })

    it('converts string attributes correctly', () => {
      const event = createTestEvent({ action: 'test-action' })
      const record = toOTLPLogRecord(event)

      const actionAttr = record.attributes.find(a => a.key === 'action')
      expect(actionAttr?.value).toEqual({ stringValue: 'test-action' })
    })

    it('converts integer attributes correctly', () => {
      const event = createTestEvent({ count: 42 })
      const record = toOTLPLogRecord(event)

      const countAttr = record.attributes.find(a => a.key === 'count')
      expect(countAttr?.value).toEqual({ intValue: '42' })
    })

    it('converts boolean attributes correctly', () => {
      const event = createTestEvent({ success: true })
      const record = toOTLPLogRecord(event)

      const successAttr = record.attributes.find(a => a.key === 'success')
      expect(successAttr?.value).toEqual({ boolValue: true })
    })

    it('keeps a nested object as one JSON attribute by default', () => {
      const event = createTestEvent({ user: { id: '123', name: 'Alice' } })
      const record = toOTLPLogRecord(event)

      expect(record.attributes.find(a => a.key === 'user')?.value)
        .toEqual({ stringValue: '{"id":"123","name":"Alice"}' })
    })

    it('flattens nested objects into dotted attributes in compact shape', () => {
      const event = createTestEvent({ user: { id: '123', name: 'Alice' } })
      const record = toOTLPLogRecord(event, 'compact')

      expect(record.attributes.find(a => a.key === 'user.id')?.value).toEqual({ stringValue: '123' })
      expect(record.attributes.find(a => a.key === 'user.name')?.value).toEqual({ stringValue: 'Alice' })
      expect(record.attributes.find(a => a.key === 'user')).toBeUndefined()
    })

    it('flattens through several levels and keeps value types', () => {
      const event = createTestEvent({ eve: { caller: { principalId: 'github:1' } }, ai: { calls: 1 } })
      const record = toOTLPLogRecord(event, 'compact')

      expect(record.attributes.find(a => a.key === 'eve.caller.principalId')?.value)
        .toEqual({ stringValue: 'github:1' })
      expect(record.attributes.find(a => a.key === 'ai.calls')?.value).toEqual({ intValue: '1' })
    })

    it('serializes arrays rather than indexing them into distinct keys', () => {
      const event = createTestEvent({ ai: { tools: [{ name: 'search' }] } })
      const record = toOTLPLogRecord(event, 'compact')

      expect(record.attributes.find(a => a.key === 'ai.tools')?.value)
        .toEqual({ stringValue: '[{"name":"search"}]' })
    })

    it('keeps an empty object as a field rather than flattening it away', () => {
      const event = createTestEvent({ user: {} })
      const record = toOTLPLogRecord(event, 'compact')

      expect(record.attributes.find(a => a.key === 'user')?.value).toEqual({ stringValue: '{}' })
    })

    it('serializes non-plain objects instead of flattening them away', () => {
      const event = createTestEvent({ startedAt: new Date('2024-01-01T12:00:00.000Z') })
      const record = toOTLPLogRecord(event, 'compact')

      expect(record.attributes.find(a => a.key === 'startedAt')?.value)
        .toEqual({ stringValue: '"2024-01-01T12:00:00.000Z"' })
    })

    it('includes traceId when present', () => {
      const event = createTestEvent({ traceId: 'abc123' })
      const record = toOTLPLogRecord(event)

      expect(record.traceId).toBe('abc123')
    })

    it('includes spanId when present', () => {
      const event = createTestEvent({ spanId: 'span456' })
      const record = toOTLPLogRecord(event)

      expect(record.spanId).toBe('span456')
    })

    it('excludes null and undefined attributes', () => {
      const event = createTestEvent({ nullValue: null, undefinedValue: undefined })
      const record = toOTLPLogRecord(event)

      expect(record.attributes.find(a => a.key === 'nullValue')).toBeUndefined()
      expect(record.attributes.find(a => a.key === 'undefinedValue')).toBeUndefined()
    })

    it('excludes base fields from attributes', () => {
      const event = createTestEvent({
        version: '1.0.0',
        commitHash: 'abc123',
        region: 'us-east-1',
      })
      const record = toOTLPLogRecord(event)

      expect(record.attributes.find(a => a.key === 'timestamp')).toBeUndefined()
      expect(record.attributes.find(a => a.key === 'level')).toBeUndefined()
      expect(record.attributes.find(a => a.key === 'service')).toBeUndefined()
      expect(record.attributes.find(a => a.key === 'environment')).toBeUndefined()
      expect(record.attributes.find(a => a.key === 'version')).toBeUndefined()
      expect(record.attributes.find(a => a.key === 'commitHash')).toBeUndefined()
      expect(record.attributes.find(a => a.key === 'region')).toBeUndefined()
    })
  })

  describe('sendToOTLP', () => {
    it('sends to correct OTLP URL', async () => {
      const event = createTestEvent()

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://localhost:4318/v1/logs')
    })

    it('handles endpoint with trailing slash', async () => {
      const event = createTestEvent()

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318/',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://localhost:4318/v1/logs')
    })

    it('sets Content-Type to application/json', async () => {
      const event = createTestEvent()

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        'Content-Type': 'application/json',
      }))
    })

    it('includes custom headers', async () => {
      const event = createTestEvent()

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
        headers: {
          'Authorization': 'Basic test-token',
          'X-Custom-Header': 'custom-value',
        },
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        'Authorization': 'Basic test-token',
        'X-Custom-Header': 'custom-value',
      }))
    })

    it('sends valid OTLP payload structure', async () => {
      const event = createTestEvent()

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)

      expect(payload).toHaveProperty('resourceLogs')
      expect(payload.resourceLogs).toHaveLength(1)
      expect(payload.resourceLogs[0]).toHaveProperty('resource')
      expect(payload.resourceLogs[0]).toHaveProperty('scopeLogs')
      expect(payload.resourceLogs[0].scopeLogs[0]).toHaveProperty('scope')
      expect(payload.resourceLogs[0].scopeLogs[0]).toHaveProperty('logRecords')
    })

    it('includes service.name in resource attributes', async () => {
      const event = createTestEvent({ service: 'my-service' })

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)
      const resourceAttrs = payload.resourceLogs[0].resource.attributes

      const serviceAttr = resourceAttrs.find((a: { key: string }) => a.key === 'service.name')
      expect(serviceAttr?.value).toEqual({ stringValue: 'my-service' })
    })

    it('overrides service.name from config', async () => {
      const event = createTestEvent({ service: 'original-service' })

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
        serviceName: 'override-service',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)
      const resourceAttrs = payload.resourceLogs[0].resource.attributes

      const serviceAttr = resourceAttrs.find((a: { key: string }) => a.key === 'service.name')
      expect(serviceAttr?.value).toEqual({ stringValue: 'override-service' })
    })

    it('includes deployment.environment in resource attributes', async () => {
      const event = createTestEvent({ environment: 'production' })

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)
      const resourceAttrs = payload.resourceLogs[0].resource.attributes

      const envAttr = resourceAttrs.find((a: { key: string }) => a.key === 'deployment.environment')
      expect(envAttr?.value).toEqual({ stringValue: 'production' })
    })

    it('includes custom resource attributes from config', async () => {
      const event = createTestEvent()

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
        resourceAttributes: {
          'custom.string': 'value',
          'custom.number': 42,
          'custom.bool': true,
        },
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)
      const resourceAttrs = payload.resourceLogs[0].resource.attributes

      expect(resourceAttrs.find((a: { key: string }) => a.key === 'custom.string')?.value).toEqual({ stringValue: 'value' })
      expect(resourceAttrs.find((a: { key: string }) => a.key === 'custom.number')?.value).toEqual({ intValue: '42' })
      expect(resourceAttrs.find((a: { key: string }) => a.key === 'custom.bool')?.value).toEqual({ boolValue: true })
    })

    it('includes scope with name evlog', async () => {
      const event = createTestEvent()

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)
      const [{ scope }] = payload.resourceLogs[0].scopeLogs

      expect(scope.name).toBe('evlog')
      expect(scope.version).toBeUndefined()
    })

    it('sends the record shape through the drain config', async () => {
      await sendToOTLP(
        { timestamp: '2024-01-01T12:00:00.000Z', level: 'info', service: 'test-service', environment: 'test', user: { id: 'u1' } },
        { endpoint: 'http://localhost:4318', recordShape: 'compact' },
      )

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const [record] = JSON.parse(options.body as string).resourceLogs[0].scopeLogs[0].logRecords
      expect(record.attributes.find((a: { key: string }) => a.key === 'user.id')).toBeDefined()
    })

    it('throws error on non-OK response', async () => {
      fetchSpy.mockResolvedValue(
        new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
      )

      const event = createTestEvent()

      await expect(sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
        retries: 0,
      })).rejects.toThrow('OTLP API error: 500 Internal Server Error')
    })
  })

  describe('sendBatchToOTLP', () => {
    it('sends multiple events in a single request', async () => {
      const events = [
        createTestEvent({ requestId: '1' }),
        createTestEvent({ requestId: '2' }),
        createTestEvent({ requestId: '3' }),
      ]

      await sendBatchToOTLP(events, {
        endpoint: 'http://localhost:4318',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)

      expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(3)
    })

    it('groups events by service into separate resourceLogs', async () => {
      const events = [
        createTestEvent({ service: 'auth', environment: 'production', requestId: '1' }),
        createTestEvent({ service: 'payments', environment: 'production', requestId: '2' }),
        createTestEvent({ service: 'auth', environment: 'production', requestId: '3' }),
      ]

      await sendBatchToOTLP(events, {
        endpoint: 'http://localhost:4318',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)

      // Should create 2 resourceLogs: one for auth, one for payments
      expect(payload.resourceLogs).toHaveLength(2)

      const authAttrs = payload.resourceLogs[0].resource.attributes
      const paymentsAttrs = payload.resourceLogs[1].resource.attributes

      const authService = authAttrs.find((a: { key: string }) => a.key === 'service.name')
      expect(authService?.value).toEqual({ stringValue: 'auth' })

      const paymentsService = paymentsAttrs.find((a: { key: string }) => a.key === 'service.name')
      expect(paymentsService?.value).toEqual({ stringValue: 'payments' })

      expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2)
      expect(payload.resourceLogs[1].scopeLogs[0].logRecords).toHaveLength(1)
    })

    it('groups events by environment into separate resourceLogs', async () => {
      const events = [
        createTestEvent({ service: 'api', environment: 'production', requestId: '1' }),
        createTestEvent({ service: 'api', environment: 'staging', requestId: '2' }),
      ]

      await sendBatchToOTLP(events, {
        endpoint: 'http://localhost:4318',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)

      expect(payload.resourceLogs).toHaveLength(2)

      const prodAttrs = payload.resourceLogs[0].resource.attributes
      const stagingAttrs = payload.resourceLogs[1].resource.attributes

      const prodEnv = prodAttrs.find((a: { key: string }) => a.key === 'deployment.environment')
      expect(prodEnv?.value).toEqual({ stringValue: 'production' })

      const stagingEnv = stagingAttrs.find((a: { key: string }) => a.key === 'deployment.environment')
      expect(stagingEnv?.value).toEqual({ stringValue: 'staging' })

      expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1)
      expect(payload.resourceLogs[1].scopeLogs[0].logRecords).toHaveLength(1)
    })

    it('does not send request for empty events array', async () => {
      await sendBatchToOTLP([], {
        endpoint: 'http://localhost:4318',
      })

      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('timeout handling', () => {
    it('uses default timeout of 5000ms', async () => {
      const event = createTestEvent()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
      })

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
    })

    it('uses custom timeout when provided', async () => {
      const event = createTestEvent()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
        timeout: 10000,
      })

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000)
    })
  })

  describe('createOTLPDrain', () => {
    const createDrainContext = (overrides?: Partial<WideEvent>) => ({
      event: createTestEvent(overrides),
      request: { method: 'GET', path: '/', requestId: 'r1' },
      headers: {},
    })

    let origNuxtOtlpEndpoint: string | undefined
    let origOtelOtlpEndpoint: string | undefined
    let origOtlpEndpoint: string | undefined

    beforeEach(() => {
      origNuxtOtlpEndpoint = process.env.NUXT_OTLP_ENDPOINT
      origOtelOtlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      origOtlpEndpoint = process.env.OTLP_ENDPOINT
      delete process.env.NUXT_OTLP_ENDPOINT
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      delete process.env.OTLP_ENDPOINT
    })

    afterEach(() => {
      if (origNuxtOtlpEndpoint === undefined) delete process.env.NUXT_OTLP_ENDPOINT
      else process.env.NUXT_OTLP_ENDPOINT = origNuxtOtlpEndpoint
      if (origOtelOtlpEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = origOtelOtlpEndpoint
      if (origOtlpEndpoint === undefined) delete process.env.OTLP_ENDPOINT
      else process.env.OTLP_ENDPOINT = origOtlpEndpoint
    })

    it('returns a callable drain that posts events', async () => {
      const drain = createOTLPDrain({ endpoint: 'http://localhost:4318' })
      await drain(createDrainContext())
      expect(fetchSpy).toHaveBeenCalledOnce()
    })

    it('resolves the endpoint from the OTLP_ENDPOINT alias', async () => {
      process.env.OTLP_ENDPOINT = 'http://localhost:4318'
      const drain = createOTLPDrain()
      await drain(createDrainContext())
      expect(fetchSpy).toHaveBeenCalledOnce()
    })

    it('logs error and skips fetch when endpoint is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const drain = createOTLPDrain()
      await drain(createDrainContext())
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[evlog/otlp] Missing endpoint'),
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
