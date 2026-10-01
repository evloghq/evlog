import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from '../../src/types'
import { sendBatchToOTLP, sendToOTLP, toOTLPLogRecord, createOTLPDrain } from '../../src/adapters/otlp'
import { EVLOG_VERSION } from '../../src/shared/http'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

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

    it('sends non-integer numbers as doubleValue', () => {
      const event = createTestEvent({ ai: { costUsd: 0.0042 } })
      const record = toOTLPLogRecord(event, 'compact')

      expect(record.attributes.find(a => a.key === 'ai.costUsd')?.value).toEqual({ doubleValue: 0.0042 })
    })

    it('sends non-finite numbers as strings', () => {
      const event = createTestEvent({ ratio: Number.NaN, limit: Number.POSITIVE_INFINITY })
      const record = toOTLPLogRecord(event)

      expect(record.attributes.find(a => a.key === 'ratio')?.value).toEqual({ stringValue: 'NaN' })
      expect(record.attributes.find(a => a.key === 'limit')?.value).toEqual({ stringValue: 'Infinity' })
    })

    it('sends arrays of same-type primitives as OTLP arrays', () => {
      const event = createTestEvent({ tags: ['beta', 'eu'], flags: [true, false], ids: [1, 2] })
      const record = toOTLPLogRecord(event)

      expect(record.attributes.find(a => a.key === 'tags')?.value)
        .toEqual({ arrayValue: { values: [{ stringValue: 'beta' }, { stringValue: 'eu' }] } })
      expect(record.attributes.find(a => a.key === 'flags')?.value)
        .toEqual({ arrayValue: { values: [{ boolValue: true }, { boolValue: false }] } })
      expect(record.attributes.find(a => a.key === 'ids')?.value)
        .toEqual({ arrayValue: { values: [{ intValue: '1' }, { intValue: '2' }] } })
    })

    it('sends a numeric array as doubles when any element is fractional', () => {
      const event = createTestEvent({ latencies: [12, 12.5] })
      const record = toOTLPLogRecord(event)

      expect(record.attributes.find(a => a.key === 'latencies')?.value)
        .toEqual({ arrayValue: { values: [{ doubleValue: 12 }, { doubleValue: 12.5 }] } })
    })

    it('serializes mixed-type and empty arrays as JSON', () => {
      const event = createTestEvent({ mixed: ['a', 1], empty: [], gaps: [1, Number.NaN] })
      const record = toOTLPLogRecord(event)

      expect(record.attributes.find(a => a.key === 'mixed')?.value).toEqual({ stringValue: '["a",1]' })
      expect(record.attributes.find(a => a.key === 'empty')?.value).toEqual({ stringValue: '[]' })
      expect(record.attributes.find(a => a.key === 'gaps')?.value).toEqual({ stringValue: '[1,null]' })
    })

    it('sends a nested object as one kvlist attribute by default', () => {
      const event = createTestEvent({ user: { id: '123', name: 'Alice', plan: { seats: 3, trial: false } } })
      const record = toOTLPLogRecord(event)

      expect(record.attributes.find(a => a.key === 'user')?.value).toEqual({
        kvlistValue: {
          values: [
            { key: 'id', value: { stringValue: '123' } },
            { key: 'name', value: { stringValue: 'Alice' } },
            {
              key: 'plan',
              value: {
                kvlistValue: {
                  values: [
                    { key: 'seats', value: { intValue: '3' } },
                    { key: 'trial', value: { boolValue: false } },
                  ],
                },
              },
            },
          ],
        },
      })
    })

    it('drops null and undefined entries inside a kvlist', () => {
      const event = createTestEvent({ user: { id: '123', email: null, name: undefined } })
      const record = toOTLPLogRecord(event)

      expect(record.attributes.find(a => a.key === 'user')?.value)
        .toEqual({ kvlistValue: { values: [{ key: 'id', value: { stringValue: '123' } }] } })
    })

    it('keeps empty and non-plain objects as JSON strings in the default shape', () => {
      const event = createTestEvent({ meta: {}, at: new Date('2024-01-01T00:00:00.000Z') })
      const record = toOTLPLogRecord(event)

      expect(record.attributes.find(a => a.key === 'meta')?.value).toEqual({ stringValue: '{}' })
      expect(record.attributes.find(a => a.key === 'at')?.value).toEqual({ stringValue: '"2024-01-01T00:00:00.000Z"' })
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

    describe('semantic conventions', () => {
      const requestEvent = createTestEvent({
        method: 'POST',
        path: '/api/checkout',
        status: 500,
        userAgent: { raw: 'Mozilla/5.0' },
        error: { name: 'PaymentError', message: 'Card declined', stack: 'PaymentError: Card declined\n    at pay' },
        ai: {
          model: 'claude-sonnet-4.6',
          provider: 'anthropic',
          responseId: 'msg_1',
          inputTokens: 1200,
          outputTokens: 300,
          cacheReadTokens: 800,
          cacheWriteTokens: 100,
          finishReason: 'stop',
        },
      })

      const attributeMap = (record: ReturnType<typeof toOTLPLogRecord>) =>
        Object.fromEntries(record.attributes.map(a => [a.key, a.value]))

      it('adds OTel semantic convention attributes when enabled', () => {
        const attributes = attributeMap(toOTLPLogRecord(requestEvent, 'compact', { semanticConventions: true }))

        expect(attributes).toMatchObject({
          'http.request.method': { stringValue: 'POST' },
          'url.path': { stringValue: '/api/checkout' },
          'http.response.status_code': { intValue: '500' },
          'user_agent.original': { stringValue: 'Mozilla/5.0' },
          'exception.type': { stringValue: 'PaymentError' },
          'exception.message': { stringValue: 'Card declined' },
          'exception.stacktrace': { stringValue: 'PaymentError: Card declined\n    at pay' },
          'gen_ai.request.model': { stringValue: 'claude-sonnet-4.6' },
          'gen_ai.provider.name': { stringValue: 'anthropic' },
          'gen_ai.response.id': { stringValue: 'msg_1' },
          'gen_ai.usage.input_tokens': { intValue: '1200' },
          'gen_ai.usage.output_tokens': { intValue: '300' },
          'gen_ai.usage.cache_read.input_tokens': { intValue: '800' },
          'gen_ai.usage.cache_creation.input_tokens': { intValue: '100' },
          'gen_ai.response.finish_reasons': { arrayValue: { values: [{ stringValue: 'stop' }] } },
        })
      })

      it('keeps the evlog field names alongside the semantic convention ones', () => {
        const attributes = attributeMap(toOTLPLogRecord(requestEvent, 'compact', { semanticConventions: true }))

        expect(attributes.method).toEqual({ stringValue: 'POST' })
        expect(attributes['ai.inputTokens']).toEqual({ intValue: '1200' })
      })

      it('adds them in the json shape too', () => {
        const attributes = attributeMap(toOTLPLogRecord(requestEvent, 'json', { semanticConventions: true }))

        expect(attributes['http.request.method']).toEqual({ stringValue: 'POST' })
        expect(attributes['gen_ai.usage.input_tokens']).toEqual({ intValue: '1200' })
      })

      it('adds none of them by default', () => {
        const attributes = attributeMap(toOTLPLogRecord(requestEvent, 'compact'))

        expect(Object.keys(attributes).filter(key => key.startsWith('http.') || key.startsWith('gen_ai.'))).toEqual([])
      })

      it('skips fields with the wrong type for the convention', () => {
        const event = createTestEvent({ method: 'GET', status: 'ok', error: 'boom' })
        const attributes = attributeMap(toOTLPLogRecord(event, 'compact', { semanticConventions: true }))

        expect(attributes['http.request.method']).toEqual({ stringValue: 'GET' })
        expect(attributes['http.response.status_code']).toBeUndefined()
        expect(attributes['exception.message']).toBeUndefined()
      })

      it('does not duplicate a key the event already sets', () => {
        const event = createTestEvent({ method: 'GET', 'http.request.method': 'PATCH' })
        const record = toOTLPLogRecord(event, 'compact', { semanticConventions: true })

        const matches = record.attributes.filter(a => a.key === 'http.request.method')
        expect(matches).toEqual([{ key: 'http.request.method', value: { stringValue: 'PATCH' } }])
      })
    })

    it('includes traceId when present', () => {
      const event = createTestEvent({ traceId: TRACE_ID })
      const record = toOTLPLogRecord(event)

      expect(record.traceId).toBe(TRACE_ID)
      expect(record.attributes.find(a => a.key === 'traceId')).toBeUndefined()
    })

    it('includes spanId when present', () => {
      const event = createTestEvent({ spanId: SPAN_ID })
      const record = toOTLPLogRecord(event)

      expect(record.spanId).toBe(SPAN_ID)
      expect(record.attributes.find(a => a.key === 'spanId')).toBeUndefined()
    })

    it('lowercases trace context ids', () => {
      const event = createTestEvent({ traceId: TRACE_ID.toUpperCase(), spanId: SPAN_ID.toUpperCase() })
      const record = toOTLPLogRecord(event)

      expect(record.traceId).toBe(TRACE_ID)
      expect(record.spanId).toBe(SPAN_ID)
    })

    it('keeps malformed trace context ids as attributes instead of record fields', () => {
      const event = createTestEvent({ traceId: 'abc123', spanId: '0000000000000000' })
      const record = toOTLPLogRecord(event)

      expect(record.traceId).toBeUndefined()
      expect(record.spanId).toBeUndefined()
      expect(record.attributes.find(a => a.key === 'traceId')?.value).toEqual({ stringValue: 'abc123' })
      expect(record.attributes.find(a => a.key === 'spanId')?.value).toEqual({ stringValue: '0000000000000000' })
    })

    it('rejects the all-zero trace id', () => {
      const event = createTestEvent({ traceId: '0'.repeat(32) })
      const record = toOTLPLogRecord(event)

      expect(record.traceId).toBeUndefined()
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

    it('adds deployment.environment.name to the resource with semantic conventions', async () => {
      const event = createTestEvent({ environment: 'production', method: 'GET' })

      await sendToOTLP(event, { endpoint: 'http://localhost:4318', semanticConventions: true })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)
      const resourceAttrs: Array<{ key: string, value: unknown }> = payload.resourceLogs[0].resource.attributes
      const recordAttrs: Array<{ key: string, value: unknown }> = payload.resourceLogs[0].scopeLogs[0].logRecords[0].attributes

      expect(resourceAttrs.find(a => a.key === 'deployment.environment.name')?.value).toEqual({ stringValue: 'production' })
      expect(resourceAttrs.find(a => a.key === 'deployment.environment')?.value).toEqual({ stringValue: 'production' })
      expect(recordAttrs.find(a => a.key === 'http.request.method')?.value).toEqual({ stringValue: 'GET' })
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

    it('includes scope with name evlog and the package version', async () => {
      const event = createTestEvent()

      await sendToOTLP(event, {
        endpoint: 'http://localhost:4318',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)
      const [{ scope }] = payload.resourceLogs[0].scopeLogs

      expect(scope).toEqual({ name: 'evlog', version: EVLOG_VERSION })
    })

    it('lets config resource attributes replace derived ones instead of duplicating them', async () => {
      await sendToOTLP(createTestEvent({ environment: 'production' }), {
        endpoint: 'http://localhost:4318',
        resourceAttributes: { 'deployment.environment': 'staging' },
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const resourceAttrs = JSON.parse(options.body as string).resourceLogs[0].resource.attributes
      const envAttrs = resourceAttrs.filter((a: { key: string }) => a.key === 'deployment.environment')

      expect(envAttrs).toEqual([{ key: 'deployment.environment', value: { stringValue: 'staging' } }])
    })

    it('gzips the body when compression is gzip', async () => {
      await sendToOTLP(createTestEvent({ requestId: 'r1' }), {
        endpoint: 'http://localhost:4318',
        compression: 'gzip',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({ 'Content-Encoding': 'gzip' }))
      const payload = JSON.parse(gunzipSync(options.body as Uint8Array).toString('utf8'))
      expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1)
    })

    it('sends the body uncompressed by default', async () => {
      await sendToOTLP(createTestEvent(), { endpoint: 'http://localhost:4318' })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).not.toHaveProperty('Content-Encoding')
      expect(typeof options.body).toBe('string')
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

    it('groups events by version into separate resourceLogs', async () => {
      const events = [
        createTestEvent({ service: 'api', version: '1.0.0' }),
        createTestEvent({ service: 'api', version: '1.1.0' }),
      ]

      await sendBatchToOTLP(events, { endpoint: 'http://localhost:4318' })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)
      const versions = payload.resourceLogs.map((r: { resource: { attributes: Array<{ key: string, value: unknown }> } }) =>
        r.resource.attributes.find(a => a.key === 'service.version')?.value)

      expect(versions).toEqual([{ stringValue: '1.0.0' }, { stringValue: '1.1.0' }])
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

    describe('OTEL_* environment variables', () => {
      beforeEach(() => {
        for (const key of [
          'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
          'OTEL_EXPORTER_OTLP_HEADERS',
          'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
          'OTLP_HEADERS',
          'NUXT_OTLP_HEADERS',
          'NUXT_OTLP_AUTH',
          'OTEL_RESOURCE_ATTRIBUTES',
          'OTEL_SERVICE_NAME',
          'NUXT_OTLP_SERVICE_NAME',
          'OTEL_EXPORTER_OTLP_COMPRESSION',
          'OTEL_EXPORTER_OTLP_LOGS_COMPRESSION',
        ]) {
          vi.stubEnv(key, undefined)
        }
      })

      afterEach(() => {
        vi.unstubAllEnvs()
      })

      const sentPayload = () => {
        const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
        return JSON.parse(options.body as string)
      }

      it('posts to OTEL_EXPORTER_OTLP_LOGS_ENDPOINT as-is, ahead of the generic endpoint', async () => {
        vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://generic:4318')
        vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'http://logs:4318/custom/logs')

        await createOTLPDrain()(createDrainContext())

        const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('http://logs:4318/custom/logs')
      })

      it('keeps an explicit endpoint ahead of OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', async () => {
        vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'http://logs:4318/custom/logs')

        await createOTLPDrain({ endpoint: 'http://explicit:4318' })(createDrainContext())

        const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('http://explicit:4318/v1/logs')
      })

      it('appends /v1/logs to an explicit endpoint equal to OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', async () => {
        vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'http://collector:4318')

        await createOTLPDrain({ endpoint: 'http://collector:4318' })(createDrainContext())

        const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('http://collector:4318/v1/logs')
      })

      it('merges OTEL_EXPORTER_OTLP_LOGS_HEADERS over the generic headers', async () => {
        vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
        vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'x-team=generic,x-shared=generic')
        vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_HEADERS', 'x-shared=logs')

        await createOTLPDrain()(createDrainContext())

        const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
        expect(options.headers).toEqual(expect.objectContaining({ 'x-team': 'generic', 'x-shared': 'logs' }))
      })

      it('percent-decodes each header value after splitting', async () => {
        vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
        vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'Authorization=Basic%20abc,x-list=a%2Cb')

        await createOTLPDrain()(createDrainContext())

        const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
        expect(options.headers).toEqual(expect.objectContaining({ 'Authorization': 'Basic abc', 'x-list': 'a,b' }))
      })

      it('keeps a value with a malformed percent escape as written', async () => {
        vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
        vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'Authorization=Bearer ab%zz')
        vi.stubEnv('OTEL_RESOURCE_ATTRIBUTES', 'discount=50%')

        await createOTLPDrain()(createDrainContext())

        const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
        expect(options.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer ab%zz' }))
        expect(sentPayload().resourceLogs[0].resource.attributes)
          .toContainEqual({ key: 'discount', value: { stringValue: '50%' } })
      })

      it('adds OTEL_RESOURCE_ATTRIBUTES to the resource without overriding evlog fields', async () => {
        vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
        vi.stubEnv('OTEL_RESOURCE_ATTRIBUTES', 'service.namespace=shop,host.name=web%2D1,service.name=ignored')

        await createOTLPDrain()(createDrainContext({ service: 'checkout' }))

        const attrs = sentPayload().resourceLogs[0].resource.attributes
        expect(attrs).toEqual(expect.arrayContaining([
          { key: 'service.namespace', value: { stringValue: 'shop' } },
          { key: 'host.name', value: { stringValue: 'web-1' } },
          { key: 'service.name', value: { stringValue: 'checkout' } },
        ]))
        expect(attrs.filter((a: { key: string }) => a.key === 'service.name')).toHaveLength(1)
      })

      it('lets config resource attributes override OTEL_RESOURCE_ATTRIBUTES', async () => {
        vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
        vi.stubEnv('OTEL_RESOURCE_ATTRIBUTES', 'service.namespace=env')

        await createOTLPDrain({ resourceAttributes: { 'service.namespace': 'config' } })(createDrainContext())

        const attrs = sentPayload().resourceLogs[0].resource.attributes
        expect(attrs.filter((a: { key: string }) => a.key === 'service.namespace'))
          .toEqual([{ key: 'service.namespace', value: { stringValue: 'config' } }])
      })

      it('gzips when OTEL_EXPORTER_OTLP_COMPRESSION is gzip', async () => {
        vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
        vi.stubEnv('OTEL_EXPORTER_OTLP_COMPRESSION', 'gzip')

        await createOTLPDrain()(createDrainContext())

        const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
        expect(options.headers).toEqual(expect.objectContaining({ 'Content-Encoding': 'gzip' }))
      })

      it('lets OTEL_EXPORTER_OTLP_LOGS_COMPRESSION override the generic compression', async () => {
        vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
        vi.stubEnv('OTEL_EXPORTER_OTLP_COMPRESSION', 'gzip')
        vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_COMPRESSION', 'none')

        await createOTLPDrain()(createDrainContext())

        const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
        expect(options.headers).not.toHaveProperty('Content-Encoding')
      })

      it('logs an error and skips fetch on an unsupported compression', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
        vi.stubEnv('OTEL_EXPORTER_OTLP_COMPRESSION', 'brotli')

        await createOTLPDrain()(createDrainContext())

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[evlog/otlp] Unsupported compression "brotli"'))
        expect(fetchSpy).not.toHaveBeenCalled()
      })
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
