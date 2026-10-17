import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initLogger } from '../../src/logger'
import type { RequestLogger } from '../../src/types'
import { evlog, evlogHandleError, createEvlogHooks, useLogger } from '../../src/sveltekit/index'
import { EvlogError } from '../../src/error'
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

function createMockEvent(method = 'GET', path = '/api/test', headers: Record<string, string> = {}) {
  const reqHeaders = new Headers(headers)
  return {
    request: new Request(`http://localhost${path}`, { method, headers: reqHeaders }),
    url: new URL(`http://localhost${path}`),
    locals: {} as Record<string, unknown>,
  }
}

function createMockResolve(status = 200): (event: ReturnType<typeof createMockEvent>) => Promise<Response> {
  return vi.fn((_ev) => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status })))
}

describeStandardHttpMatrix({
  name: 'sveltekit',
  mount(options) {
    const handle = evlog(options)
    return Promise.resolve({
      async fire(req) {
        const event = createMockEvent(req.method || 'GET', req.path, req.headers || {})
        const resolve = createMockResolve()
        await handle({ event, resolve })
        return { status: 200 }
      },
    })
  },
})

describe('evlog/sveltekit', () => {
  beforeEach(() => {
    initLogger({
      env: { service: 'sveltekit-test' },
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

  it('creates a logger accessible via event.locals.log', async () => {
    const handle = evlog()
    const event = createMockEvent()
    const resolve = createMockResolve()

    await handle({ event, resolve })

    expect(event.locals.log).toBeDefined()
    expect(typeof event.locals.log.set).toBe('function')
    expect(typeof event.locals.log.error).toBe('function')
    expect(typeof event.locals.log.info).toBe('function')
    expect(typeof event.locals.log.warn).toBe('function')
  })

  it('accumulates context set by route handler', async () => {
    const { drain } = createPipelineSpies()
    const handle = evlog({ drain })
    const event = createMockEvent('GET', '/api/users')
    const resolve = vi.fn(() => {
      useLogger().set({ user: { id: 'u-1' }, db: { queries: 3 } })
      return new Response(JSON.stringify({ users: [] }), { status: 200 })
    })

    await handle({ event, resolve })
    await waitForDrainCalls(drain)

    const emitted = defined(
      findEventViaDrain(drain, e => e.path === '/api/users'),
      'accumulated context event',
    )
    expect(emitted.user).toEqual({ id: 'u-1' })
    expect(emitted.db).toEqual({ queries: 3 })
  })

  it('logs error status when handler throws', async () => {
    const { drain } = createPipelineSpies()
    const handle = evlog({ drain })
    const event = createMockEvent('GET', '/api/fail')
    const resolve = vi.fn(() => {
      throw new Error('Something broke')
    })

    await expect(handle({ event, resolve })).rejects.toThrow('Something broke')
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, {
      path: '/api/fail',
      level: 'error',
    })
  })

  it('returns structured JSON response for thrown EvlogError', async () => {
    const handle = evlog()
    const event = createMockEvent('GET', '/api/checkout')
    const resolve = vi.fn(() => {
      throw new EvlogError({
        message: 'Payment failed',
        status: 402,
        why: 'Card declined by issuer',
        fix: 'Try a different card',
        link: 'https://docs.example.com/payments',
        data: { orderId: 'ord_1' },
      })
    })

    const response = await handle({ event, resolve })

    expect(response.status).toBe(402)
    expect(response.headers.get('content-type')).toBe('application/json')

    const body = await response.json()
    expect(body.message).toBe('Payment failed')
    expect(body.data.why).toBe('Card declined by issuer')
    expect(body.data.fix).toBe('Try a different card')
    expect(body.data.link).toBe('https://docs.example.com/payments')
    expect(body.data.orderId).toBe('ord_1')
  })

  it('logs EvlogError before returning structured response', async () => {
    const { drain } = createPipelineSpies()
    const handle = evlog({ drain })
    const event = createMockEvent('GET', '/api/checkout')
    const resolve = vi.fn(() => {
      throw new EvlogError({ message: 'Payment failed', status: 402 })
    })

    await handle({ event, resolve })

    expect(drain).toHaveBeenCalledOnce()
    const drainCtx = getDrainCallArg(defined(drain.mock.calls[0], 'drain call'))
    expect(drainCtx.event.level).toBe('error')
    expect(drainCtx.event.status).toBe(402)
  })

  it('re-throws non-EvlogError errors', async () => {
    const handle = evlog()
    const event = createMockEvent('GET', '/api/fail')
    const resolve = vi.fn(() => {
      throw new Error('Unexpected crash')
    })

    await expect(handle({ event, resolve })).rejects.toThrow('Unexpected crash')
  })

  it('intercepts 500 response when handleError logged an EvlogError', async () => {
    // Simulate SvelteKit's behavior: resolve() catches the error via handleError,
    // then returns a 500 Response. Our handle hook should detect the EvlogError
    // from the logger context and return a structured response instead.
    const handle = evlog()
    const handleError = evlogHandleError()
    const event = createMockEvent('GET', '/api/checkout')

    const evlogError = new EvlogError({
      message: 'Payment failed',
      status: 402,
      why: 'Card declined',
      fix: 'Try another card',
      data: { orderId: 'ord_1' },
    })

    // Simulate SvelteKit's resolve: calls handleError, then returns 500
    const resolve = vi.fn(() => {
      // SvelteKit calls handleError before returning the response
      handleError({ error: evlogError, event, status: 500, message: 'Internal Error' })
      return new Response('Internal Error', { status: 500 })
    })

    const response = await handle({ event, resolve })

    // Should intercept the 500 and return structured 402
    expect(response.status).toBe(402)
    expect(response.headers.get('content-type')).toBe('application/json')

    const body = await response.json()
    expect(body.message).toBe('Payment failed')
    expect(body.status).toBe(402)
    expect(body.data.why).toBe('Card declined')
    expect(body.data.fix).toBe('Try another card')
    expect(body.data.orderId).toBe('ord_1')
  })

  it('skips routes not matching include patterns', async () => {
    const handle = evlog({ include: ['/api/**'] })
    const event = createMockEvent('GET', '/health')
    const resolve = createMockResolve()

    await handle({ event, resolve })

    expect(event.locals.log).toBeUndefined()
  })

  it('logs routes matching include patterns', async () => {
    const { drain } = createPipelineSpies()
    const handle = evlog({ include: ['/api/**'], drain })
    const event = createMockEvent('GET', '/api/data')
    const resolve = createMockResolve()

    await handle({ event, resolve })
    await waitForDrainCalls(drain)

    expect(findEventViaDrain(drain, e => e.path === '/api/data')).toBeDefined()
  })

  it('handles POST requests with correct method', async () => {
    const { drain } = createPipelineSpies()
    const handle = evlog({ drain })
    const event = createMockEvent('POST', '/api/checkout')
    const resolve = createMockResolve()

    await handle({ event, resolve })
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/checkout', method: 'POST' })
  })

  it('excludes routes matching exclude patterns', async () => {
    const handle = evlog({ exclude: ['/_internal/**'] })
    const event = createMockEvent('GET', '/_internal/probe')
    const resolve = createMockResolve()

    await handle({ event, resolve })

    expect(event.locals.log).toBeUndefined()
  })

  describe('drain / enrich / keep', () => {
    it('calls drain with emitted event (shared helpers)', async () => {
      const { drain } = createPipelineSpies()

      const handle = evlog({ drain })
      const event = createMockEvent('GET', '/api/test')
      const resolve = vi.fn(() => {
        useLogger().set({ user: { id: 'u-1' } })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      })

      await handle({ event, resolve })

      assertDrainCalledWith(drain, { path: '/api/test', method: 'GET', level: 'info', status: 200 })
      const [[ctx]] = drain.mock.calls
      expect(ctx.headers).toBeDefined()
    })

    it('calls enrich before drain (shared helpers)', async () => {
      const { drain, enrich } = createPipelineSpies()
      enrich.mockImplementation((ctx) => {
        ctx.event.enriched = true
      })

      const handle = evlog({ enrich, drain })
      const event = createMockEvent('GET', '/api/test')
      const resolve = createMockResolve()

      await handle({ event, resolve })

      assertEnrichBeforeDrain(enrich, drain)
      expect(drain.mock.calls[0][0].event.enriched).toBe(true)
    })

    it('enrich receives response status and safe headers', async () => {
      const { enrich } = createPipelineSpies()

      const handle = evlog({ enrich })
      const event = createMockEvent('GET', '/api/test', {
        'user-agent': 'test-bot/1.0',
        'x-custom': 'value',
      })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(enrich).toHaveBeenCalledOnce()
      const ctx = defined(enrich.mock.calls[0]?.[0], 'enrich context')
      expect(ctx.response?.status).toBe(200)
      expect(ctx.headers?.['user-agent']).toBe('test-bot/1.0')
      expect(ctx.headers?.['x-custom']).toBe('value')
    })

    it('filters sensitive headers (shared helpers)', async () => {
      const { drain } = createPipelineSpies()

      const handle = evlog({ drain })
      const event = createMockEvent('GET', '/api/test', {
        'authorization': 'Bearer secret-token',
        'cookie': 'session=abc',
        'x-safe': 'visible',
      })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      const ctx = getDrainCallArg(defined(drain.mock.calls[0], 'drain call'))
      assertSensitiveHeadersFiltered(ctx)
      expect(ctx.headers?.['x-safe']).toBe('visible')
    })

    it('calls keep callback for tail sampling', async () => {
      const { keep, drain } = createPipelineSpies()
      keep.mockImplementation((ctx) => {
        if (ctx.context.important) ctx.shouldKeep = true
      })

      const handle = evlog({ keep, drain })
      const event = createMockEvent('GET', '/api/test')
      const resolve = vi.fn(() => {
        useLogger().set({ important: true })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      })

      await handle({ event, resolve })

      expect(keep).toHaveBeenCalledOnce()
      expect(keep.mock.calls[0][0].path).toBe('/api/test')
      expect(drain).toHaveBeenCalledOnce()
    })

    it('drain error does not break request', async () => {
      const drain = vi.fn(() => {
        throw new Error('drain exploded')
      })

      const handle = evlog({ drain })
      const event = createMockEvent('GET', '/api/test')
      const resolve = createMockResolve()

      const response = await handle({ event, resolve })
      expect(response.status).toBe(200)
      expect(drain).toHaveBeenCalledOnce()
    })

    it('enrich error does not prevent drain', async () => {
      const { drain } = createPipelineSpies()
      const enrich = vi.fn(() => {
        throw new Error('enrich exploded')
      })

      const handle = evlog({ enrich, drain })
      const event = createMockEvent('GET', '/api/test')
      const resolve = createMockResolve()

      const response = await handle({ event, resolve })
      expect(response.status).toBe(200)
      expect(enrich).toHaveBeenCalledOnce()
      expect(drain).toHaveBeenCalledOnce()
    })

    it('does not call drain/enrich when route is skipped', async () => {
      const { drain, enrich } = createPipelineSpies()

      const handle = evlog({ include: ['/api/**'], drain, enrich })
      const event = createMockEvent('GET', '/health')
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(drain).not.toHaveBeenCalled()
      expect(enrich).not.toHaveBeenCalled()
    })
  })

  describe('useLogger()', () => {
    it('returns the request-scoped logger from anywhere in the call stack', async () => {
      const { drain } = createPipelineSpies()
      const handle = evlog({ drain })

      let loggerFromService: RequestLogger | undefined
      const resolve = vi.fn(() => {
        loggerFromService = useLogger()
        useLogger().set({ fromService: true })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      })

      const event = createMockEvent('GET', '/api/test')
      await handle({ event, resolve })
      await waitForDrainCalls(drain)

      expect(typeof defined(loggerFromService).set).toBe('function')
      expect(findEventViaDrain(drain, e => e.fromService === true)).toBeDefined()
    })

    it('returns the same logger as event.locals.log', async () => {
      const handle = evlog()

      let isSame = false
      const event = createMockEvent('GET', '/api/test')
      const resolve = vi.fn(() => {
        isSame = useLogger() === defined(event.locals.log, 'event.locals.log in resolve')
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      })

      await handle({ event, resolve })
      expect(isSame).toBe(true)
    })

    it('throws when called outside handle context', () => {
      expect(() => useLogger()).toThrow('[evlog] useLogger()')
    })

    it('works across async boundaries', async () => {
      const { drain } = createPipelineSpies()
      const handle = evlog({ drain })

      async function asyncService() {
        await new Promise(resolve => setTimeout(resolve, 5))
        useLogger().set({ asyncWork: 'done' })
      }

      const resolve = vi.fn(async () => {
        await asyncService()
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      })

      const event = createMockEvent('GET', '/api/test')
      await handle({ event, resolve })
      await waitForDrainCalls(drain)

      expect(findEventViaDrain(drain, e => e.asyncWork === 'done')).toBeDefined()
    })
  })

  describe('evlogHandleError()', () => {
    it('logs error via event.locals.log when available', async () => {
      const handle = evlog()
      const handleError = evlogHandleError()
      const event = createMockEvent('GET', '/api/fail')

      // First set up the logger via the handle hook
      const resolve = vi.fn(() => {
        throw new Error('Something broke')
      })
      await handle({ event, resolve }).catch(() => {})

      // Now call handleError as SvelteKit would
      const error = new Error('Something broke')
      handleError({ error, event, status: 500, message: 'Internal Error' })

      // The error should have been logged via locals.log
      expect(event.locals.log).toBeDefined()
    })

    it('returns structured response for EvlogError', () => {
      const handleError = evlogHandleError()
      const event = createMockEvent('GET', '/api/checkout')
      event.locals.log = {
        set() {},
        error() {},
        info() {},
        warn() {},
        emit() {
          return null
        },
        getContext() {
          return {}
        },
      }

      const error = new EvlogError({
        message: 'Payment failed',
        status: 402,
        why: 'Card declined',
        fix: 'Try another card',
        link: 'https://docs.example.com/payments',
      })

      const result = defined(
        handleError({ error, event, status: 402, message: 'Payment failed' }),
        'EvlogError handleError result',
      )

      expect(result.message).toBe('Payment failed')
      expect(result.status).toBe(402)
      expect(result.why).toBe('Card declined')
      expect(result.fix).toBe('Try another card')
      expect(result.link).toBe('https://docs.example.com/payments')
    })

    it('returns generic response for non-EvlogError', () => {
      const handleError = evlogHandleError()
      const event = createMockEvent('GET', '/api/fail')
      event.locals.log = {
        set() {},
        error() {},
        info() {},
        warn() {},
        emit() {
          return null
        },
        getContext() {
          return {}
        },
      }

      const result = defined(
        handleError({
          error: new Error('Something broke'),
          event,
          status: 500,
          message: 'Internal Error',
        }),
        'generic handleError result',
      )

      expect(result.message).toBe('Internal Error')
      expect(result.status).toBe(500)
      expect(result.why).toBeUndefined()
    })

    it('handles missing logger gracefully', () => {
      const handleError = evlogHandleError()
      const event = createMockEvent('GET', '/api/fail')
      // No locals.log set

      const result = defined(
        handleError({
          error: new Error('crash'),
          event,
          status: 500,
          message: 'Internal Error',
        }),
        'handleError result without logger',
      )

      expect(result.message).toBe('Internal Error')
    })

    describe('SvelteKit 3 input (#911)', () => {
      function createKit3Input(kind: 'unknown' | 'framework', error: unknown, event: ReturnType<typeof createMockEvent>) {
        const deprecatedReads: string[] = []
        const input = { kind, error, event }
        // Kit 3 dev mode exposes `status` and `message` as deprecated getters that warn on access
        Object.defineProperties(input, {
          status: {
            get() {
              deprecatedReads.push('status')
              return 500
            },
          },
          message: {
            get() {
              deprecatedReads.push('message')
              return 'Internal Error'
            },
          },
        })
        return { input, deprecatedReads }
      }

      it('logs an unknown error and returns nothing so Kit keeps its defaults', () => {
        const handleError = evlogHandleError()
        const event = createMockEvent('GET', '/api/fail')
        const logError = vi.fn()
        event.locals.log = { error: logError, emit: () => null }
        const error = new Error('Something broke')
        const { input, deprecatedReads } = createKit3Input('unknown', error, event)

        expect(handleError(input)).toBeUndefined()
        expect(logError).toHaveBeenCalledWith(error)
        expect(deprecatedReads).toEqual([])
      })

      it('returns the EvlogError status and message', () => {
        const handleError = evlogHandleError()
        const event = createMockEvent('GET', '/api/checkout')
        const error = new EvlogError({ message: 'Payment failed', status: 402, why: 'Card declined' })
        const { input, deprecatedReads } = createKit3Input('unknown', error, event)

        expect(handleError(input)).toEqual({ message: 'Payment failed', status: 402, why: 'Card declined' })
        expect(deprecatedReads).toEqual([])
      })

      it('returns nothing for a framework error', () => {
        const handleError = evlogHandleError()
        const event = createMockEvent('GET', '/missing')
        const { input, deprecatedReads } = createKit3Input('framework', { status: 404, message: 'Not Found' }, event)

        expect(handleError(input)).toBeUndefined()
        expect(deprecatedReads).toEqual([])
      })
    })
  })

  describe('createEvlogHooks()', () => {
    it('returns both handle and handleError', () => {
      const hooks = createEvlogHooks()
      expect(typeof hooks.handle).toBe('function')
      expect(typeof hooks.handleError).toBe('function')
    })

    it('handle works with options', async () => {
      const { drain } = createPipelineSpies()
      const { handle } = createEvlogHooks({ drain })
      const event = createMockEvent('GET', '/api/test')
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(drain).toHaveBeenCalledOnce()
      expect(event.locals.log).toBeDefined()
    })

    it('handleError returns structured EvlogError response', () => {
      const { handleError } = createEvlogHooks()
      const event = createMockEvent('GET', '/api/checkout')
      event.locals.log = {
        set() {},
        error() {},
        info() {},
        warn() {},
        emit() {
          return null
        },
        getContext() {
          return {}
        },
      }

      const error = new EvlogError({
        message: 'Payment failed',
        status: 402,
        why: 'Card declined',
      })

      const result = defined(
        handleError({ error, event, status: 402, message: 'Payment failed' }),
        'createEvlogHooks handleError result',
      )
      expect(result.why).toBe('Card declined')
    })
  })

  it('defers emit for streaming responses until the body completes (#321)', async () => {
    const { drain } = createPipelineSpies()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = evlog({ drain })
    const event = createMockEvent('POST', '/api/chat')

    let closeStream!: () => void
    const encoder = new TextEncoder()
    const resolve = vi.fn(() => {
      const log = useLogger()
      let close: (() => void) | undefined
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('hello'))
          close = () => {
            controller.enqueue(encoder.encode(' world'))
            controller.close()
          }
        },
      })
      closeStream = defined(close, 'close stream')
      queueMicrotask(() => {
        log.set({ ai: { calls: 1, totalTokens: 42 } })
      })
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    })

    const response = await handle({ event, resolve })
    expect(drain).not.toHaveBeenCalled()

    closeStream()
    await expect(response.text()).resolves.toBe('hello world')
    await waitForDrainCalls(drain)

    expect(warnSpy.mock.calls.some(([message]) => String(message).includes('Keys dropped: ai'))).toBe(false)
    expect(findEventViaDrain(drain, e => e.path === '/api/chat')?.ai).toEqual({ calls: 1, totalTokens: 42 })
  })
})
