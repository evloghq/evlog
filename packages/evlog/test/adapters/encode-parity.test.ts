import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from '../../src/types'
import { createAxiomDrain, sendBatchToAxiom } from '../../src/adapters/axiom'
import { createBetterStackDrain, sendBatchToBetterStack } from '../../src/adapters/better-stack'
import { createDatadogDrain, sendBatchToDatadog } from '../../src/adapters/datadog'
import { createOTLPDrain, sendBatchToOTLP } from '../../src/adapters/otlp'
import { createSazabiDrain, sendBatchToSazabi } from '../../src/adapters/sazabi'
import { createSentryDrain, sendBatchToSentry } from '../../src/adapters/sentry'
import { createWebhookDrain, sendAuditWebhook } from '../../src/adapters/webhook'
import { buildAuditFields } from '../../src/shared/audit-fields'

const event: WideEvent = {
  timestamp: '2024-01-01T12:00:00.000Z',
  level: 'info',
  service: 'test',
  environment: 'test',
  method: 'GET',
  path: '/api/users',
  status: 200,
}

const DSN = 'https://abc123@o1.ingest.sentry.io/42'

const record = buildAuditFields({ action: 'invoice.refund', actor: { type: 'user', id: 'usr_1' } })
const auditEvent: WideEvent = { ...event, audit: record }
const WEBHOOK = { url: 'https://hooks.example.com/audit', secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw' }

/**
 * Each adapter builds its request once and uses it from both the drain path
 * (`defineHttpDrain({ encode })`) and the standalone `sendBatchTo*` helper.
 * These specs pin that the two paths stay byte-identical on the wire and
 * report failures with the same label.
 */
interface ParityCase {
  name: string
  label: string
  drain: () => (ctx: { event: WideEvent }) => Promise<void>
  send: () => Promise<void>
  /** Mask fields that differ per call by design (timestamps, generated ids). */
  normalize?: (body: string) => string
  /** The event the drain receives, when the adapter needs more than the request event. */
  event?: WideEvent
}

const ADAPTERS: ParityCase[] = [
  {
    name: 'axiom',
    label: 'Axiom',
    drain: () => createAxiomDrain({ dataset: 'ds', apiKey: 'key' }),
    send: () => sendBatchToAxiom([event], { dataset: 'ds', apiKey: 'key' }),
  },
  {
    name: 'better-stack',
    label: 'Better Stack',
    drain: () => createBetterStackDrain({ apiKey: 'key' }),
    send: () => sendBatchToBetterStack([event], { apiKey: 'key' }),
  },
  {
    name: 'datadog',
    label: 'Datadog',
    drain: () => createDatadogDrain({ apiKey: 'key' }),
    send: () => sendBatchToDatadog([event], { apiKey: 'key' }),
  },
  {
    name: 'otlp',
    label: 'OTLP',
    drain: () => createOTLPDrain({ endpoint: 'http://localhost:4318' }),
    send: () => sendBatchToOTLP([event], { endpoint: 'http://localhost:4318' }),
  },
  {
    name: 'sazabi',
    label: 'OTLP',
    drain: () => createSazabiDrain({ endpoint: 'https://key.us-west-2.intake.sazabi.com' }),
    send: () => sendBatchToSazabi([event], { endpoint: 'https://key.us-west-2.intake.sazabi.com' }),
  },
  {
    name: 'webhook',
    label: 'Webhook',
    drain: () => createWebhookDrain(WEBHOOK),
    send: () => sendAuditWebhook([record], WEBHOOK),
    event: auditEvent,
  },
  {
    name: 'sentry',
    label: 'Sentry',
    drain: () => createSentryDrain({ dsn: DSN }),
    send: () => sendBatchToSentry([event], { dsn: DSN }),
    // The envelope header carries a send timestamp, and events without trace
    // context get a freshly generated trace id — both differ per call by
    // design, so they are not part of the parity comparison.
    normalize: (body: string) =>
      body
        .replace(/"sent_at":"[^"]+"/g, '"sent_at":"<ts>"')
        .replace(/"trace_id":"[^"]+"/g, '"trace_id":"<trace>"'),
  },
]

describe('adapter encode parity', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // The webhook signature covers the send time in seconds, so both paths must sign at the same instant.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each(ADAPTERS)('$name: drain and sendBatch issue the same request', async (adapter) => {
    await adapter.drain()({ event: adapter.event ?? event })
    await adapter.send()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const [drainUrl, drainInit] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const [sendUrl, sendInit] = fetchSpy.mock.calls[1] as [string, RequestInit]

    const normalize = adapter.normalize ?? ((body: string) => body)
    expect(drainUrl).toBe(sendUrl)
    expect(normalize(drainInit.body as string)).toEqual(normalize(sendInit.body as string))
    expect(drainInit.headers).toEqual(sendInit.headers)
  })

  it.each(ADAPTERS)('$name: both paths report failures with the same label', async (adapter) => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 400, statusText: 'Bad Request' }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(adapter.send()).rejects.toThrow(`${adapter.label} API error: 400 Bad Request`)

    // The drain path swallows the error but logs it — same label.
    await adapter.drain()({ event: adapter.event ?? event })
    const logged = errorSpy.mock.calls.flat().map(String).join(' ')
    expect(logged).toContain(`${adapter.label} API error: 400 Bad Request`)
  })
})
