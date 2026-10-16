import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from '../../src/types'
import { sendBatchToAxiom, sendToAxiom, createAxiomDrain } from '../../src/adapters/axiom'
import { enableDeprecationWarnings } from '../helpers/deprecations'

describe('axiom adapter', () => {
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

  describe('sendToAxiom', () => {
    it('sends event to correct Axiom URL', async () => {
      const event = createTestEvent()

      await sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.axiom.co/v1/datasets/my-dataset/ingest?timestamp-field=timestamp')
    })

    it('uses custom base URL when provided', async () => {
      const event = createTestEvent()

      await sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
        baseUrl: 'https://custom.axiom.co',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://custom.axiom.co/v1/datasets/my-dataset/ingest?timestamp-field=timestamp')
    })

    it('uses edgeUrl for edge ingest endpoint', async () => {
      const event = createTestEvent()

      await sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
        edgeUrl: 'https://eu-central-1.aws.edge.axiom.co',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://eu-central-1.aws.edge.axiom.co/v1/ingest/my-dataset?timestamp-field=timestamp')
    })

    it('uses edgeUrl as-is when custom path is provided', async () => {
      const event = createTestEvent()

      await sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
        edgeUrl: 'http://localhost:3400/custom/ingest/',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://localhost:3400/custom/ingest?timestamp-field=timestamp')
    })

    it('URL encodes dataset name', async () => {
      const event = createTestEvent()

      await sendToAxiom(event, {
        dataset: 'my dataset/test',
        apiKey: 'test-token',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.axiom.co/v1/datasets/my%20dataset%2Ftest/ingest?timestamp-field=timestamp')
    })

    it('URL encodes dataset name for edge ingest endpoint', async () => {
      const event = createTestEvent()

      await sendToAxiom(event, {
        dataset: 'my dataset/test',
        apiKey: 'test-token',
        edgeUrl: 'https://eu-central-1.aws.edge.axiom.co',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://eu-central-1.aws.edge.axiom.co/v1/ingest/my%20dataset%2Ftest?timestamp-field=timestamp')
    })

    it('sets correct Authorization header', async () => {
      const event = createTestEvent()

      await sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'my-secret-token',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        'Authorization': 'Bearer my-secret-token',
      }))
    })

    it('includes X-Axiom-Org-Id header when orgId is provided', async () => {
      const event = createTestEvent()

      await sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
        orgId: 'my-org-123',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        'X-Axiom-Org-Id': 'my-org-123',
      }))
    })

    it('does not include X-Axiom-Org-Id header when orgId is not provided', async () => {
      const event = createTestEvent()

      await sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const headers = options.headers as Record<string, string>
      expect(headers['X-Axiom-Org-Id']).toBeUndefined()
    })

    it('sets Content-Type to application/json', async () => {
      const event = createTestEvent()

      await sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        'Content-Type': 'application/json',
      }))
    })

    it('sends event as JSON array in body', async () => {
      const event = createTestEvent({ action: 'test-action', userId: '123' })

      await sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
      })

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(options.body as string)
      expect(body).toEqual([event])
    })

    it('throws error on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Bad Request', { status: 400, statusText: 'Bad Request' }),
      )

      const event = createTestEvent()

      await expect(sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
      })).rejects.toThrow('Axiom API error: 400 Bad Request')
    })

    it('warns when Axiom reports partial ingest failures', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ingested: 1, failed: 1, failures: [{ error: 'invalid timestamp' }] }), { status: 200 }),
      )

      await sendToAxiom(createTestEvent(), { dataset: 'my-dataset', apiKey: 'test-token' })

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1 event(s) failed to ingest'))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid timestamp'))
    })

    it('warns on schema messages from Axiom', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          ingested: 1,
          failed: 0,
          messages: [{ priority: 'warn', code: 'schema_rules_drop:debug', msg: 'field "debug" dropped: not in declared schema' }],
        }), { status: 200 }),
      )

      await sendToAxiom(createTestEvent(), { dataset: 'my-dataset', apiKey: 'test-token' })

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('field "debug" dropped'))
    })
  })

  describe('sendBatchToAxiom', () => {
    it('sends multiple events in a single request', async () => {
      const events = [
        createTestEvent({ requestId: '1' }),
        createTestEvent({ requestId: '2' }),
        createTestEvent({ requestId: '3' }),
      ]

      await sendBatchToAxiom(events, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(options.body as string)
      expect(body).toHaveLength(3)
      expect(body).toEqual(events)
    })

    it('sends empty array when no events', async () => {
      await sendBatchToAxiom([], {
        dataset: 'my-dataset',
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

      // Mock setTimeout to capture the timeout value
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      await sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
      })

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
    })

    it('uses custom timeout when provided', async () => {
      const event = createTestEvent()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      await sendToAxiom(event, {
        dataset: 'my-dataset',
        apiKey: 'test-token',
        timeout: 10000,
      })

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000)
    })
  })

  describe('createAxiomDrain', () => {
    const createDrainContext = (overrides?: Partial<WideEvent>) => ({
      event: createTestEvent(overrides),
      request: { method: 'GET', path: '/', requestId: 'r1' },
      headers: {},
    })

    beforeEach(enableDeprecationWarnings)

    afterEach(() => {
      vi.unstubAllEnvs()
      delete process.env.NUXT_AXIOM_API_KEY
      delete process.env.AXIOM_API_KEY
      delete process.env.NUXT_AXIOM_DATASET
      delete process.env.AXIOM_DATASET
      delete process.env.NUXT_AXIOM_TOKEN
      delete process.env.AXIOM_TOKEN
    })

    it('returns a callable drain that posts events', async () => {
      const drain = createAxiomDrain({ apiKey: 'test-key', dataset: 'logs' })
      await drain(createDrainContext())
      expect(fetchSpy).toHaveBeenCalledOnce()
    })

    it('logs error and skips fetch when credentials are missing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const drain = createAxiomDrain()
      await drain(createDrainContext())
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Set AXIOM_API_KEY/AXIOM_DATASET env vars'),
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('warns when legacy token alias is used', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const drain = createAxiomDrain({ token: 'legacy-key', dataset: 'logs' })
      await drain(createDrainContext())
      expect(warnSpy).toHaveBeenCalledWith(
        '[evlog/axiom] \'token\' is deprecated and removed in v3, use \'apiKey\' instead.',
      )
    })

    it('accepts legacy token alias', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const drain = createAxiomDrain({ token: 'legacy-key', dataset: 'logs' })
      await drain(createDrainContext())
      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(options.headers).toEqual(expect.objectContaining({
        Authorization: 'Bearer legacy-key',
      }))
    })
  })
})
