import { AsyncLocalStorage } from 'node:async_hooks'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { context, ROOT_CONTEXT, trace, TraceFlags, type Context, type ContextManager } from '@opentelemetry/api'
import { initLogger } from '../../src/logger'
import { evlog, type EvlogVariables } from '../../src/hono/index'
import { createOtelPlugin } from '../../src/otel/index'
import { definePlugin } from '../../src/shared/plugin'
import { createPipelineSpies, findEventViaDrain, waitForDrainCalls } from '../helpers/framework'
import { defined } from '../helpers/defined'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

/** The context manager `@opentelemetry/context-async-hooks` provides, without the SDK. */
class AsyncLocalStorageContextManager implements ContextManager {
  private storage = new AsyncLocalStorage<Context>()
  active() {
    return this.storage.getStore() ?? ROOT_CONTEXT
  }
  with<TArgs extends unknown[], TFn extends(...args: TArgs) => ReturnType<TFn>>(ctx: Context, fn: TFn, thisArg?: ThisParameterType<TFn>, ...args: TArgs) {
    return this.storage.run(ctx, () => fn.apply(thisArg, args))
  }
  bind<T>(_ctx: Context, target: T) {
    return target
  }
  enable() {
    return this
  }
  disable() {
    this.storage.disable()
    return this
  }
}

function inSpan<T>(traceId: string, spanId: string, fn: () => T): T {
  const span = trace.wrapSpanContext({ traceId, spanId, traceFlags: TraceFlags.SAMPLED })
  return context.with(trace.setSpan(context.active(), span), fn)
}

function mount(plugins = [createOtelPlugin()]) {
  const { drain } = createPipelineSpies()
  const app = new Hono<EvlogVariables>()
  app.use(evlog({ drain, plugins }))
  app.get('/api/orders', c => c.json({ ok: true }))
  return { app, drain }
}

describe('evlog/otel', () => {
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager())
  })

  afterAll(() => {
    context.disable()
  })

  beforeEach(() => {
    initLogger({ env: { service: 'otel-test' }, pretty: false })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets traceId and spanId from the span active when the request starts', async () => {
    const { app, drain } = mount()

    const response = await inSpan(TRACE_ID, SPAN_ID, () => app.request('/api/orders'))
    await waitForDrainCalls(drain)

    expect(response.status).toBe(200)
    const event = defined(findEventViaDrain(drain, e => e.path === '/api/orders'), 'orders event')
    expect(event.traceId).toBe(TRACE_ID)
    expect(event.spanId).toBe(SPAN_ID)
  })

  it('leaves both fields out when no span is active', async () => {
    const { app, drain } = mount()

    await app.request('/api/orders')
    await waitForDrainCalls(drain)

    const event = defined(findEventViaDrain(drain, e => e.path === '/api/orders'), 'orders event')
    expect(event.status).toBe(200)
    expect(event).not.toHaveProperty('traceId')
    expect(event).not.toHaveProperty('spanId')
  })

  it('leaves both fields out when the active span context is invalid', async () => {
    const { app, drain } = mount()

    await inSpan('0'.repeat(32), '0'.repeat(16), () => app.request('/api/orders'))
    await waitForDrainCalls(drain)

    const event = defined(findEventViaDrain(drain, e => e.path === '/api/orders'), 'orders event')
    expect(event).not.toHaveProperty('traceId')
    expect(event).not.toHaveProperty('spanId')
  })

  it('keeps a traceId an earlier plugin already set and still fills spanId', async () => {
    const existing = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const pinTrace = definePlugin({
      name: 'pin-trace',
      onRequestStart({ logger }) {
        logger.set({ traceId: existing })
      },
    })
    const { app, drain } = mount([pinTrace, createOtelPlugin()])

    await inSpan(TRACE_ID, SPAN_ID, () => app.request('/api/orders'))
    await waitForDrainCalls(drain)

    const event = defined(findEventViaDrain(drain, e => e.path === '/api/orders'), 'orders event')
    expect(event.traceId).toBe(existing)
    expect(event.spanId).toBe(SPAN_ID)
  })

  it('keeps the request span on a streamed response that ends outside the span', async () => {
    const { drain } = createPipelineSpies()
    const app = new Hono<EvlogVariables>()
    app.use(evlog({ drain, plugins: [createOtelPlugin()] }))
    let close!: () => void
    app.get('/api/stream', () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: one\n\n'))
          close = () => controller.close()
        },
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })

    const response = await inSpan(TRACE_ID, SPAN_ID, () => app.request('/api/stream'))
    expect(trace.getActiveSpan()).toBeUndefined()
    close()
    await response.text()
    await waitForDrainCalls(drain)

    const event = defined(findEventViaDrain(drain, e => e.path === '/api/stream'), 'stream event')
    expect(event.traceId).toBe(TRACE_ID)
    expect(event.spanId).toBe(SPAN_ID)
  })
})
