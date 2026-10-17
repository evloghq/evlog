import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { initLogger } from '../../src/logger'
import { createError } from '../../src/error'
import { parseError } from '../../src/runtime/utils/parseError'
import { evlog, useLogger, type EvlogVariables } from '../../src/hono/index'
import {
  assertDrainCalledWith,
  assertEnrichBeforeDrain,
  assertHttpEventEmitted,
  assertSensitiveHeadersFiltered,
  createPipelineSpies,
  findEventViaDrain,
  waitForDrainCalls,
} from '../helpers/framework'
import { defined, getDrainCallArg } from '../helpers/defined'
import { describeStandardHttpMatrix } from '../helpers/frameworkMatrix'
import { createDeferredStream } from '../helpers/stream'

describeStandardHttpMatrix({
  name: 'hono',
  mount(options) {
    const app = new Hono<EvlogVariables>()
    app.use(evlog(options))
    app.get('/api/users', (c) => c.json({ users: [] }))
    return Promise.resolve({
      async fire(req) {
        const res = await app.request(req.path, {
          method: req.method || 'GET',
          headers: req.headers,
        })
        return { status: res.status }
      },
    })
  },
})

describe('evlog/hono', () => {
  beforeEach(() => {
    initLogger({
      env: { service: 'hono-test' },
      pretty: false,
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a logger accessible via c.get("log")', async () => {
    const app = new Hono<EvlogVariables>()
    app.use(evlog())

    let hasLogger = false
    app.get('/api/test', (c) => {
      const log = c.get('log')
      hasLogger = log !== undefined && typeof log.set === 'function'
      return c.json({ ok: true })
    })

    await app.request('/api/test')
    expect(hasLogger).toBe(true)
  })

  it('accumulates context set by route handler', async () => {
    const { drain } = createPipelineSpies()
    const app = new Hono<EvlogVariables>()
    app.use(evlog({ drain }))
    app.get('/api/users', (c) => {
      c.get('log').set({ user: { id: 'u-1' }, db: { queries: 3 } })
      return c.json({ users: [] })
    })

    await app.request('/api/users')
    await waitForDrainCalls(drain)

    const event = defined(
      findEventViaDrain(drain, e => e.path === '/api/users'),
      'accumulated context event',
    )
    expect(event.user).toEqual({ id: 'u-1' })
    expect(event.db).toEqual({ queries: 3 })
  })

  it('answers 500 for a thrown EvlogError without a status', async () => {
    const { drain } = createPipelineSpies()
    const app = new Hono<EvlogVariables>()
    app.use(evlog({ drain }))
    app.get('/api/turn', () => {
      throw createError({ message: 'Turn could not start', why: 'Agent queue is full' })
    })

    const res = await app.request('/api/turn')
    await waitForDrainCalls(drain)

    expect(res.status).toBe(500)
    assertHttpEventEmitted(drain, { path: '/api/turn', status: 500, level: 'error' })
  })

  it('logs status 500 when handler throws and Hono handles the error', async () => {
    const { drain } = createPipelineSpies()
    const app = new Hono<EvlogVariables>()
    app.use(evlog({ drain }))
    app.get('/api/fail', () => {
      throw new Error('Something broke')
    })

    await app.request('/api/fail')
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/fail', status: 500 })
  })

  it('carries the createError data payload through onError', async () => {
    const { drain } = createPipelineSpies()
    const app = new Hono<EvlogVariables>()
    app.use(evlog({ drain }))
    app.get('/api/checkout', () => {
      throw createError({
        message: 'Payment failed',
        status: 402,
        why: 'Card declined by issuer',
        data: { orderId: 'ord_1', retryable: true },
      })
    })
    app.onError((error, c) => {
      const parsed = parseError(error)
      return c.json({ message: parsed.message, ...parsed.data }, 402)
    })

    const response = await app.request('/api/checkout')
    await waitForDrainCalls(drain)

    expect(await response.json()).toEqual({
      message: 'Payment failed',
      why: 'Card declined by issuer',
      orderId: 'ord_1',
      retryable: true,
    })

    const event = defined(
      findEventViaDrain(drain, e => e.path === '/api/checkout'),
      'checkout error event',
    )
    expect(event.level).toBe('error')
    expect(event.status).toBe(402)
    expect(event.error).toMatchObject({
      name: 'EvlogError',
      message: 'Payment failed',
      data: { why: 'Card declined by issuer', orderId: 'ord_1', retryable: true },
    })
  })

  it('records the response status onError returned, not the status of the error', async () => {
    const { drain } = createPipelineSpies()
    const app = new Hono<EvlogVariables>()
    app.use(evlog({ drain }))
    app.get('/api/fail', () => {
      throw createError({ message: 'Payment failed', status: 402 })
    })
    app.onError((_error, c) => c.json({ error: 'handled' }, 500))

    await app.request('/api/fail')
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/fail', status: 500, level: 'error' })
  })

  it('logs error context set manually by route handler', async () => {
    const { drain } = createPipelineSpies()
    const app = new Hono<EvlogVariables>()
    app.use(evlog({ drain }))
    app.get('/api/fail', (c) => {
      const log = c.get('log')
      log.error(new Error('Manual error'))
      return c.json({ error: 'handled' }, 500)
    })

    await app.request('/api/fail')
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/fail', level: 'error', status: 500 })
  })

  it('skips routes not matching include patterns', async () => {
    const app = new Hono<EvlogVariables>()
    app.use(evlog({ include: ['/api/**'] }))

    let logValue: unknown = 'untouched'
    app.get('/health', (c) => {
      try {
        logValue = c.get('log') 
      } catch {
        logValue = undefined 
      }
      return c.json({ ok: true })
    })

    await app.request('/health')
    expect(logValue).toBeUndefined()
  })

  it('logs routes matching include patterns', async () => {
    const { drain } = createPipelineSpies()
    const app = new Hono<EvlogVariables>()
    app.use(evlog({ include: ['/api/**'], drain }))
    app.get('/api/data', (c) => {
      c.get('log').set({ data: true })
      return c.json({ ok: true })
    })

    await app.request('/api/data')
    await waitForDrainCalls(drain)

    expect(findEventViaDrain(drain, e => e.path === '/api/data')).toBeDefined()
  })

  it('handles POST requests with correct method', async () => {
    const { drain } = createPipelineSpies()
    const app = new Hono<EvlogVariables>()
    app.use(evlog({ drain }))
    app.post('/api/checkout', (c) => c.json({ ok: true }))

    await app.request('/api/checkout', { method: 'POST' })
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/checkout', method: 'POST' })
  })

  it('excludes routes matching exclude patterns', async () => {
    const app = new Hono<EvlogVariables>()
    app.use(evlog({ exclude: ['/_internal/**'] }))

    let logValue: unknown = 'untouched'
    app.get('/_internal/probe', (c) => {
      try {
        logValue = c.get('log') 
      } catch {
        logValue = undefined 
      }
      return c.json({ ok: true })
    })

    await app.request('/_internal/probe')
    expect(logValue).toBeUndefined()
  })

  describe('waitUntil', () => {
    it('returns the response before a slow drain settles, via executionCtx.waitUntil', async () => {
      // A drain that stays pending until we release it: if the response only
      // resolved after the drain, this test would time out rather than pass.
      let releaseDrain!: () => void
      const drainDone = new Promise<void>((resolve) => {
        releaseDrain = resolve
      })
      const drain = vi.fn().mockReturnValue(drainDone)

      const pending: Promise<unknown>[] = []
      const executionCtx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} }

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ drain }))
      app.get('/api/test', (c) => c.json({ ok: true }))

      const response = await app.request('/api/test', {}, {}, executionCtx)

      // Response is done while the drain is still in flight.
      expect(response.status).toBe(200)
      expect(drain).toHaveBeenCalledTimes(1)
      expect(pending).toHaveLength(1)

      let settled = false
      void Promise.all(pending).then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      releaseDrain()
      await Promise.all(pending)
      expect(settled).toBe(true)

      assertDrainCalledWith(drain, { path: '/api/test', method: 'GET', status: 200 })
    })

    it('drains inline when the runtime has no executionCtx', async () => {
      const { drain } = createPipelineSpies()

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ drain }))
      app.get('/api/test', (c) => c.json({ ok: true }))

      await app.request('/api/test')

      assertDrainCalledWith(drain, { path: '/api/test', method: 'GET', status: 200 })
    })

    it('per-request options.waitUntil takes precedence over executionCtx', async () => {
      const { drain } = createPipelineSpies()
      const fromOption: Promise<unknown>[] = []
      const fromCtx: Promise<unknown>[] = []
      const executionCtx = { waitUntil: (p: Promise<unknown>) => fromCtx.push(p), passThroughOnException: () => {} }

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ drain, waitUntil: (p) => fromOption.push(p) }))
      app.get('/api/test', (c) => c.json({ ok: true }))

      await app.request('/api/test', {}, {}, executionCtx)

      expect(fromOption.length).toBeGreaterThan(0)
      expect(fromCtx).toHaveLength(0)
      await Promise.all(fromOption)
    })
  })

  describe('drain / enrich / keep', () => {
    it('calls drain with emitted event (shared helpers)', async () => {
      const { drain } = createPipelineSpies()

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ drain }))
      app.get('/api/test', (c) => {
        c.get('log').set({ user: { id: 'u-1' } })
        return c.json({ ok: true })
      })

      await app.request('/api/test')

      assertDrainCalledWith(drain, { path: '/api/test', method: 'GET', level: 'info', status: 200 })
      const [[ctx]] = drain.mock.calls
      expect(ctx.headers).toBeDefined()
    })

    it('calls enrich before drain (shared helpers)', async () => {
      const { drain, enrich } = createPipelineSpies()
      enrich.mockImplementation((ctx) => {
        ctx.event.enriched = true 
      })

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ enrich, drain }))
      app.get('/api/test', (c) => c.json({ ok: true }))

      await app.request('/api/test')

      assertEnrichBeforeDrain(enrich, drain)
      expect(drain.mock.calls[0][0].event.enriched).toBe(true)
    })

    it('enrich receives response status and safe headers', async () => {
      const { enrich } = createPipelineSpies()

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ enrich }))
      app.get('/api/test', (c) => c.json({ ok: true }))

      await app.request('/api/test', {
        headers: { 'user-agent': 'test-bot/1.0', 'x-custom': 'value' },
      })

      expect(enrich).toHaveBeenCalledOnce()
      const ctx = defined(enrich.mock.calls[0]?.[0], 'enrich context')
      expect(ctx.response?.status).toBe(200)
      expect(ctx.headers?.['user-agent']).toBe('test-bot/1.0')
      expect(ctx.headers?.['x-custom']).toBe('value')
    })

    it('filters sensitive headers (shared helpers)', async () => {
      const { drain } = createPipelineSpies()

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ drain }))
      app.get('/api/test', (c) => c.json({ ok: true }))

      await app.request('/api/test', {
        headers: {
          'authorization': 'Bearer secret-token',
          'cookie': 'session=abc',
          'x-safe': 'visible',
        },
      })

      const ctx = getDrainCallArg(defined(drain.mock.calls[0], 'drain call'))
      assertSensitiveHeadersFiltered(ctx)
      expect(ctx.headers?.['x-safe']).toBe('visible')
    })

    it('calls keep callback for tail sampling', async () => {
      const { keep, drain } = createPipelineSpies()
      keep.mockImplementation((ctx) => {
        if (ctx.context.important) ctx.shouldKeep = true
      })

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ keep, drain }))
      app.get('/api/test', (c) => {
        c.get('log').set({ important: true })
        return c.json({ ok: true })
      })

      await app.request('/api/test')

      expect(keep).toHaveBeenCalledOnce()
      expect(keep.mock.calls[0][0].path).toBe('/api/test')
      expect(drain).toHaveBeenCalledOnce()
    })

    it('calls drain on error responses', async () => {
      const { drain } = createPipelineSpies()

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ drain }))
      app.get('/api/fail', (c) => {
        c.get('log').error(new Error('something broke'))
        return c.json({ error: 'fail' }, 500)
      })

      await app.request('/api/fail')

      assertDrainCalledWith(drain, { path: '/api/fail', level: 'error', status: 500 })
    })

    it('drain error does not break request', async () => {
      const drain = vi.fn(() => {
        throw new Error('drain exploded') 
      })

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ drain }))
      app.get('/api/test', (c) => c.json({ ok: true }))

      const res = await app.request('/api/test')
      expect(res.status).toBe(200)
      expect(drain).toHaveBeenCalledOnce()
    })

    it('enrich error does not prevent drain', async () => {
      const { drain } = createPipelineSpies()
      const enrich = vi.fn(() => {
        throw new Error('enrich exploded') 
      })

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ enrich, drain }))
      app.get('/api/test', (c) => c.json({ ok: true }))

      const res = await app.request('/api/test')
      expect(res.status).toBe(200)
      expect(enrich).toHaveBeenCalledOnce()
      expect(drain).toHaveBeenCalledOnce()
    })

    it('does not call drain/enrich when route is skipped', async () => {
      const { drain, enrich } = createPipelineSpies()

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ include: ['/api/**'], drain, enrich }))
      app.get('/health', (c) => c.json({ ok: true }))

      await app.request('/health')

      expect(drain).not.toHaveBeenCalled()
      expect(enrich).not.toHaveBeenCalled()
    })
  })

  describe('streaming responses', () => {
    it('does not lock the response body when the handler returns a streaming SSE response (#382)', async () => {
      const { drain } = createPipelineSpies()
      let closeStream!: () => void

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ drain }))
      app.get('/api/stream', () => {
        const { stream, close } = createDeferredStream()
        closeStream = close
        return new Response(stream, {
          headers: { 'content-type': 'text/event-stream' },
        })
      })

      const res = await app.request('/api/stream')
      expect(res.status).toBe(200)

      // Body must not be locked — @hono/node-server calls body.getReader() to
      // stream to the client after app.fetch() resolves.
      expect(res.body).not.toBeNull()
      expect(res.body?.locked).toBe(false)

      closeStream()
      await res.text()
      await waitForDrainCalls(drain)
      assertHttpEventEmitted(drain, { path: '/api/stream', status: 200 })
    })

    it('defers drain until the SSE stream closes and captures mid-stream context (#321)', async () => {
      const { drain } = createPipelineSpies()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      let closeStream!: () => void

      const app = new Hono<EvlogVariables>()
      app.use(evlog({ drain }))
      app.get('/api/chat', (c) => {
        const log = c.get('log')
        const { stream, close } = createDeferredStream()
        closeStream = close
        queueMicrotask(() => {
          log.set({ ai: { calls: 1, totalTokens: 42 } })
        })
        return new Response(stream, {
          headers: { 'content-type': 'text/event-stream' },
        })
      })

      const res = await app.request('/api/chat')
      expect(drain).not.toHaveBeenCalled()

      closeStream()
      await expect(res.text()).resolves.toBe('hello world')
      await vi.waitFor(() => {
        expect(drain).toHaveBeenCalledTimes(1)
      })

      expect(warnSpy.mock.calls.some(([message]) => String(message).includes('Keys dropped: ai'))).toBe(false)
      expect(drain.mock.calls[0]?.[0]?.event?.ai).toEqual({ calls: 1, totalTokens: 42 })
    })
  })

  describe('useLogger', () => {
    it('returns the same logger as c.get("log")', async () => {
      const app = new Hono<EvlogVariables>()
      app.use(evlog())

      let fromContext: unknown
      let fromUseLogger: unknown
      app.get('/api/test', (c) => {
        fromContext = c.get('log')
        fromUseLogger = useLogger()
        return c.json({ ok: true })
      })

      await app.request('/api/test')
      expect(fromUseLogger).toBe(fromContext)
    })

    it('reaches nested async calls without threading the context', async () => {
      const { drain } = createPipelineSpies()
      const app = new Hono<EvlogVariables>()
      app.use(evlog({ drain }))

      async function chargeCard() {
        await Promise.resolve()
        useLogger().set({ payment: { amount: 42 } })
      }

      app.get('/api/pay', async (c) => {
        await chargeCard()
        return c.json({ ok: true })
      })

      await app.request('/api/pay')
      await waitForDrainCalls(drain)

      const event = defined(findEventViaDrain(drain, e => e.path === '/api/pay'), 'payment event')
      expect(event.payment).toEqual({ amount: 42 })
    })

    it('throws a helpful error outside a request', () => {
      expect(() => useLogger()).toThrow('useLogger() was called outside of an evlog middleware context')
    })

    it('throws on a route filtered out by exclude', async () => {
      const app = new Hono<EvlogVariables>()
      app.use(evlog({ exclude: ['/health'] }))

      let thrown = false
      app.get('/health', (c) => {
        try {
          useLogger()
        } catch {
          thrown = true
        }
        return c.json({ ok: true })
      })

      await app.request('/health')
      expect(thrown).toBe(true)
    })

    // Attaching AsyncLocalStorage also enables `log.fork()` on Hono, which
    // previously had no storage and so no fork.
    it('exposes log.fork() for post-response work', async () => {
      const { drain } = createPipelineSpies()
      const app = new Hono<EvlogVariables>()
      app.use(evlog({ drain }))

      app.get('/api/test', (c) => {
        const log = c.get('log')
        expect(typeof log.fork).toBe('function')
        log.fork!('cleanup', () => {
          useLogger().set({ cleaned: true })
        })
        return c.json({ ok: true })
      })

      await app.request('/api/test')
      await vi.waitFor(() => {
        expect(findEventViaDrain(drain, e => e.operation === 'cleanup')).toBeDefined()
      })

      const child = defined(findEventViaDrain(drain, e => e.operation === 'cleanup'), 'forked event')
      expect(child.cleaned).toBe(true)
      expect(child._parentRequestId).toBeDefined()
    })
  })
})
