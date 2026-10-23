import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { FetchHttpClient, HttpClient, HttpRouter, HttpServerResponse } from 'effect/http'
import { initLogger } from '../../src/logger'
import { createPostHogDrain } from '../../src/adapters/posthog'
import { createSentryDrain } from '../../src/adapters/sentry'
import {
  WaitUntil,
  EvlogLogger,
  routerLayer,
  traceHeaders,
  withRequestLogger,
  withTracePropagation,
  withLogger,
} from '../../src/effect/index'
import { createPipelineSpies, findEventViaDrain, waitForDrainCalls } from '../helpers/framework'
import { defined, getDrainCallArg } from '../helpers/defined'
import { getFetchCall, getFetchJson, mockFetch } from '../helpers/fetch'

const CLIENT_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const CLIENT_SPAN_ID = '00f067aa0ba902b7'

type FetchHandler = (request: Request) => Promise<Response>

/** An in-memory network: each host is served by one Fetch handler. */
function createNetwork() {
  const hosts = new Map<string, FetchHandler>()
  const received: Array<{ host: string, headers: Headers }> = []
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const { host } = new URL(request.url)
    received.push({ host, headers: request.headers })
    return defined(hosts.get(host), `host ${host}`)(request)
  }
  return { hosts, received, fetch: fetch as typeof globalThis.fetch }
}

describe('evlog/effect trace propagation', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'effect-test' }, pretty: false })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('follows one action across five hops with the same trace id', async () => {
    const { drain } = createPipelineSpies()
    const network = createNetwork()
    const httpClient = Layer.provide(FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, network.fetch))

    // Each hop calls the next one through Effect's HttpClient, except the gateway,
    // which reaches the Durable Object through a plain `fetch` (a stub call).
    const callNext = (url: string) => Effect.gen(function* () {
      const client = withTracePropagation(yield* HttpClient.HttpClient)
      yield* client.get(url)
    }).pipe(Effect.provide(httpClient), Effect.orDie)

    const serve = (path: `/${string}`, next?: string) => HttpRouter.toWebHandler(
      HttpRouter.add('GET', path, Effect.gen(function* () {
        if (next) yield* callNext(next)
        return HttpServerResponse.text('ok')
      })).pipe(Layer.provide(routerLayer({ drain }))),
      { disableLogger: true },
    ).handler

    network.hosts.set('proxy', serve('/v1/messages'))
    network.hosts.set('tools', serve('/tools/search', 'http://proxy/v1/messages'))
    network.hosts.set('runner', serve('/turns', 'http://tools/tools/search'))
    network.hosts.set('room', request => Effect.runPromise(
      callNext('http://runner/turns').pipe(
        Effect.as(new Response('ok')),
        withRequestLogger(request, { drain }),
      ),
    ))
    const gateway = HttpRouter.toWebHandler(
      HttpRouter.add('POST', '/threads/1/messages', Effect.gen(function* () {
        const headers = yield* traceHeaders
        yield* Effect.promise(() => network.fetch('http://room/messages', { headers }))
        return HttpServerResponse.text('ok')
      })).pipe(Layer.provide(routerLayer({ drain }))),
      { disableLogger: true },
    ).handler

    await gateway(new Request('http://gateway/threads/1/messages', {
      method: 'POST',
      headers: {
        traceparent: `00-${CLIENT_TRACE_ID}-${CLIENT_SPAN_ID}-01`,
        tracestate: 'vendor=abc',
      },
    }))
    await waitForDrainCalls(drain, 5)

    const events = drain.mock.calls.map(call => getDrainCallArg(call).event)
    expect(events.map(event => event.path).sort()).toEqual(['/messages', '/threads/1/messages', '/tools/search', '/turns', '/v1/messages'])
    for (const event of events) expect(event.traceId).toBe(CLIENT_TRACE_ID)

    const gatewayEvent = defined(findEventViaDrain(drain, e => e.path === '/threads/1/messages'), 'gateway')
    expect(gatewayEvent.parentSpanId).toBe(CLIENT_SPAN_ID)
    const roomEvent = defined(findEventViaDrain(drain, e => e.path === '/messages'), 'room')
    expect(roomEvent.parentSpanId).toBe(gatewayEvent.spanId)

    expect(network.received.map(({ host }) => host)).toEqual(['room', 'runner', 'tools', 'proxy'])
    for (const { headers } of network.received) {
      expect(headers.get('traceparent')).toMatch(new RegExp(`^00-${CLIENT_TRACE_ID}-[\\da-f]{16}-01$`))
      expect(headers.get('tracestate')).toBe('vendor=abc')
    }
  })

  it('returns no trace headers outside a span', async () => {
    await expect(Effect.runPromise(traceHeaders)).resolves.toEqual({})
  })

  it('writes the span of the current unit into traceparent', async () => {
    const { drain } = createPipelineSpies()

    const headers = await Effect.runPromise(traceHeaders.pipe(withLogger('job', { drain, tracestate: 'vendor=xyz' })))
    await waitForDrainCalls(drain)

    const { event } = getDrainCallArg(defined(drain.mock.calls[0], 'drain call'))
    expect(headers).toEqual({
      traceparent: `00-${event.traceId}-${event.spanId}-01`,
      tracestate: 'vendor=xyz',
    })
  })
})

describe('evlog/effect drains', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'effect-test' }, pretty: false })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const failingTurn = Effect.gen(function* () {
    const log = yield* EvlogLogger
    log.set({ userId: 'user_1' })
    return yield* Effect.fail(new Error('model timed out'))
  })

  it('sends the trace id to PostHog events as a property', async () => {
    const fetchSpy = mockFetch()
    const drain = createPostHogDrain({ mode: 'events', apiKey: 'phc_test' })

    await Effect.runPromiseExit(failingTurn.pipe(withLogger('turn', { drain })))

    const body = getFetchJson<{ batch: Array<{ distinct_id: string, properties: Record<string, unknown> }> }>(fetchSpy)
    const [event] = body.batch
    expect(defined(event, 'posthog event').distinct_id).toBe('user_1')
    expect(event?.properties.traceId).toMatch(/^[\da-f]{32}$/)
    expect(event?.properties.error).toMatchObject({ message: 'model timed out' })
  })

  it('sends the trace id to PostHog logs as the record trace id', async () => {
    const fetchSpy = mockFetch()
    const drain = createPostHogDrain({ apiKey: 'phc_test' })

    await Effect.runPromiseExit(failingTurn.pipe(withLogger('turn', { drain })))

    const body = getFetchJson<{ resourceLogs: Array<{ scopeLogs: Array<{ logRecords: Array<{ traceId?: string }> }> }> }>(fetchSpy)
    const record = body.resourceLogs[0]?.scopeLogs[0]?.logRecords[0]
    expect(defined(record, 'log record').traceId).toMatch(/^[\da-f]{32}$/)
  })

  it('sends the trace id to Sentry logs', async () => {
    const fetchSpy = mockFetch()
    const { drain: spy } = createPipelineSpies()
    const sentry = createSentryDrain({ dsn: 'https://public@o0.ingest.sentry.io/123' })

    await Effect.runPromiseExit(failingTurn.pipe(withLogger('turn', {
      drain: async (ctx) => {
        await spy(ctx)
        await sentry(ctx)
      },
    })))

    const wide = getDrainCallArg(defined(spy.mock.calls[0], 'drain call')).event
    const { init } = getFetchCall(fetchSpy)
    const [, , payload] = String(init.body).split('\n')
    const [log] = JSON.parse(defined(payload, 'log payload')).items
    expect(log).toMatchObject({ trace_id: wide.traceId, level: 'error' })
  })

  it('gives the Sentry issue of a failed unit the trace id of its wide event', async () => {
    const fetchSpy = mockFetch()
    const { drain: spy } = createPipelineSpies()
    const sentry = createSentryDrain({ dsn: 'https://public@o0.ingest.sentry.io/123', issues: true })

    await Effect.runPromiseExit(failingTurn.pipe(withLogger('turn', {
      drain: async (ctx) => {
        await spy(ctx)
        await sentry(ctx)
      },
    })))

    const wide = getDrainCallArg(defined(spy.mock.calls[0], 'drain call')).event
    const items = Array.from({ length: fetchSpy.mock.calls.length }, (_, index) => {
      const [, item, payload] = String(getFetchCall(fetchSpy, index).init.body).split('\n')
      return {
        type: JSON.parse(defined(item, 'item header')).type as string,
        payload: JSON.parse(defined(payload, 'payload')),
      }
    })
    const issue = defined(items.find(item => item.type === 'event'), 'error event').payload
    const [log] = defined(items.find(item => item.type === 'log'), 'log').payload.items

    expect(wide.traceId).toMatch(/^[\da-f]{32}$/)
    expect(issue.contexts.trace).toMatchObject({ trace_id: wide.traceId, span_id: wide.spanId })
    expect(issue.exception.values[0]).toMatchObject({ value: 'model timed out' })
    expect(log.trace_id).toBe(wide.traceId)
  })

  it('ships drains through waitUntil on Workers', async () => {
    const fetchSpy = mockFetch()
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>()
    const drain = createSentryDrain({ dsn: 'https://public@o0.ingest.sentry.io/123' })

    await Effect.runPromiseExit(failingTurn.pipe(
      withLogger('turn', { drain }),
      Effect.provideService(WaitUntil, waitUntil),
    ))
    await Promise.all(waitUntil.mock.calls.map(([promise]) => promise))

    expect(waitUntil).toHaveBeenCalled()
    expect(getFetchCall(fetchSpy).url).toBe('https://o0.ingest.sentry.io/api/123/envelope/')
  })
})
