import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from '../../src/types'
import {
  HYPERDX_DEFAULT_OTLP_HTTP_ENDPOINT,
  sendBatchToHyperDX,
  sendToHyperDX,
  toHyperDXOTLPConfig,
  createHyperDXDrain,
} from '../../src/adapters/hyperdx'
import type { OTLPExportLogsRequest } from '../../src/adapters/otlp'
import { sendBatchToOTLP } from '../../src/adapters/otlp'
import { getFetchJson } from '../helpers/fetch'
import { defined } from '../helpers/defined'

describe('hyperdx adapter', () => {
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

  describe('toHyperDXOTLPConfig', () => {
    it('defaults endpoint to HyperDX cloud OTLP HTTP URL from docs', () => {
      const otlp = toHyperDXOTLPConfig({
        apiKey: 'hdx-test-key',
      })
      expect(otlp.endpoint).toBe(HYPERDX_DEFAULT_OTLP_HTTP_ENDPOINT)
      expect(otlp.endpoint).toBe('https://in-otel.hyperdx.io')
    })

    it('sets authorization header to the API key per HyperDX OpenTelemetry docs', () => {
      const otlp = toHyperDXOTLPConfig({
        apiKey: 'my-ingestion-key',
      })
      expect(otlp.headers).toEqual({
        authorization: 'my-ingestion-key',
      })
    })
  })

  describe('sendToHyperDX', () => {
    it('POSTs OTLP JSON to default cloud endpoint /v1/logs', async () => {
      const event = createTestEvent()

      await sendToHyperDX(event, {
        apiKey: 'k',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://in-otel.hyperdx.io/v1/logs')
    })

    it('uses custom OTLP HTTP base URL when endpoint is overridden', async () => {
      const event = createTestEvent()

      await sendToHyperDX(event, {
        apiKey: 'k',
        endpoint: 'https://otel.my-company.internal',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://otel.my-company.internal/v1/logs')
    })

    it('sends authorization header with API key', async () => {
      const event = createTestEvent()

      await sendToHyperDX(event, {
        apiKey: 'secret-hdx-key',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        authorization: 'secret-hdx-key',
        'Content-Type': 'application/json',
      }))
    })

    it('sends valid OTLP resourceLogs payload', async () => {
      const event = createTestEvent()

      await sendToHyperDX(event, {
        apiKey: 'k',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(options.body as string)
      expect(payload).toHaveProperty('resourceLogs')
      expect(payload.resourceLogs[0].scopeLogs[0].scope.name).toBe('evlog')
    })
  })

  describe('sendBatchToHyperDX', () => {
    it('no-ops on empty batch', async () => {
      await sendBatchToHyperDX([], { apiKey: 'k' })
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('createHyperDXDrain', () => {
    const createDrainContext = (overrides?: Partial<WideEvent>) => ({
      event: createTestEvent(overrides),
      request: { method: 'GET', path: '/', requestId: 'r1' },
      headers: {},
    })

    let origNuxtHyperdxApiKey: string | undefined
    let origHyperdxApiKey: string | undefined

    beforeEach(() => {
      origNuxtHyperdxApiKey = process.env.NUXT_HYPERDX_API_KEY
      origHyperdxApiKey = process.env.HYPERDX_API_KEY
      delete process.env.NUXT_HYPERDX_API_KEY
      delete process.env.HYPERDX_API_KEY
    })

    afterEach(() => {
      if (origNuxtHyperdxApiKey === undefined) delete process.env.NUXT_HYPERDX_API_KEY
      else process.env.NUXT_HYPERDX_API_KEY = origNuxtHyperdxApiKey
      if (origHyperdxApiKey === undefined) delete process.env.HYPERDX_API_KEY
      else process.env.HYPERDX_API_KEY = origHyperdxApiKey
    })

    it('returns a callable drain that posts events', async () => {
      const drain = createHyperDXDrain({ apiKey: 'test-key' })
      await drain(createDrainContext())
      expect(fetchSpy).toHaveBeenCalledOnce()
    })

    it('logs error and skips fetch when apiKey is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const drain = createHyperDXDrain()
      await drain(createDrainContext())
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[evlog/hyperdx] Missing apiKey'),
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
  describe('OTLP record options', () => {
    const event = (): WideEvent => createTestEvent({ method: 'POST', path: '/api/checkout', status: 500, user: { plan: 'pro' } })
    const firstRecord = () => {
      const body = getFetchJson<OTLPExportLogsRequest>(fetchSpy)
      const resourceLog = defined(body.resourceLogs[0], 'resourceLogs[0]')
      const scopeLog = defined(resourceLog.scopeLogs[0], 'scopeLogs[0]')
      return defined(scopeLog.logRecords[0], 'logRecords[0]')
    }
    const attributeKeys = () => firstRecord().attributes.map(attribute => attribute.key)

    it('toHyperDXOTLPConfig passes recordShape and semanticConventions through', () => {
      expect(toHyperDXOTLPConfig({ apiKey: 'k', recordShape: 'json', semanticConventions: false })).toMatchObject({
        recordShape: 'json',
        semanticConventions: false,
      })
    })

    it('leaves both options unset by default, so the shared OTLP defaults apply', () => {
      const otlp = toHyperDXOTLPConfig({ apiKey: 'k' })
      expect(otlp.recordShape).toBeUndefined()
      expect(otlp.semanticConventions).toBeUndefined()
    })

    it('sends the same request as the shared OTLP default', async () => {
      await sendToHyperDX(event(), { apiKey: 'k' })
      const hyperdxBody = getFetchJson(fetchSpy)

      fetchSpy.mockClear()
      await sendBatchToOTLP([event()], { endpoint: 'https://otlp.example.com' })
      expect(hyperdxBody).toEqual(getFetchJson(fetchSpy))
    })

    it('defaults to the compact shape with semantic conventions on', async () => {
      await sendToHyperDX(event(), { apiKey: 'k' })
      expect(firstRecord().body.stringValue).toBe('POST /api/checkout (500)')
      expect(attributeKeys()).toEqual(expect.arrayContaining(['user.plan', 'http.request.method', 'http.response.status_code']))
    })

    it('keeps the 2.x output with recordShape json and semanticConventions false', async () => {
      await sendToHyperDX(event(), { apiKey: 'k', recordShape: 'json', semanticConventions: false })
      expect(JSON.parse(firstRecord().body.stringValue)).toMatchObject({ path: '/api/checkout', user: { plan: 'pro' } })
      expect(attributeKeys()).not.toContain('http.request.method')
      expect(attributeKeys()).not.toContain('url.path')
    })

    it('applies the same options when they are passed to createHyperDXDrain', async () => {
      const drain = createHyperDXDrain({ apiKey: 'k', recordShape: 'json', semanticConventions: false })
      await drain({ event: event(), request: { method: 'POST', path: '/api/checkout', requestId: 'r1' }, headers: {} })
      expect(JSON.parse(firstRecord().body.stringValue)).toMatchObject({ path: '/api/checkout' })
      expect(attributeKeys()).not.toContain('http.request.method')
    })
  })
})
