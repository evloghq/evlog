import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrainContext } from '../../src/types'
import { initLogger } from '../../src/logger'
import { createDrainPipeline } from '../../src/pipeline'
import { globallyRedacted } from '../../src/redact'
import { createMiddlewareLogger } from '../../src/shared/middleware'
import { defined } from '../helpers/defined'
import { createPipelineSpies, waitForDrainCalls } from '../helpers/framework'
import { withFakeTimers } from '../helpers/timers'

describe('createMiddlewareLogger', () => {
  beforeEach(() => {
    initLogger({
      env: { service: 'test-app' },
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

  it('creates a logger with method, path, and requestId', () => {
    const { logger, skipped } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/users',
      requestId: 'req-123',
    })

    expect(skipped).toBe(false)
    const ctx = logger.getContext()
    expect(ctx.method).toBe('GET')
    expect(ctx.path).toBe('/api/users')
    expect(ctx.requestId).toBe('req-123')
  })

  it('generates a requestId when not provided', () => {
    const { logger } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/users',
    })

    const ctx = logger.getContext()
    expect(ctx.requestId).toBeDefined()
    expect(typeof ctx.requestId).toBe('string')
  })

  it('skips when path does not match include patterns', () => {
    const { skipped, logger } = createMiddlewareLogger({
      method: 'GET',
      path: '/health',
      include: ['/api/**'],
    })

    expect(skipped).toBe(true)
    expect(logger.getContext()).toEqual({})
  })

  it('skips when path matches exclude patterns', () => {
    const { skipped } = createMiddlewareLogger({
      method: 'GET',
      path: '/_internal/probe',
      exclude: ['/_internal/**'],
    })

    expect(skipped).toBe(true)
  })

  it.each(['disabled', 'excluded', 'not-included'])(
    'accepts audit calls without emitting when logging is %s', async (mode) => {
      const { drain } = createPipelineSpies()
      initLogger({ enabled: mode !== 'disabled', drain, silent: true })
      const { logger, finish, skipped } = createMiddlewareLogger({
        method: 'GET', path: '/health',
        exclude: mode === 'excluded' ? ['/health'] : undefined,
        include: mode === 'not-included' ? ['/api/**'] : undefined,
      })

      expect(skipped).toBe(true)
      expect(() => logger.audit({ action: 'health.read', actor: { type: 'user', id: 'u1' } })).not.toThrow()
      expect(() => logger.audit.deny('denied', { action: 'health.read', actor: { type: 'user', id: 'u1' } })).not.toThrow()
      expect(logger.getContext()).toEqual({})
      expect(await finish({ status: 200 })).toBeNull()
      expect(drain).not.toHaveBeenCalled()
    },
  )

  it('does not skip when path matches include patterns', () => {
    const { skipped } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/users',
      include: ['/api/**'],
    })

    expect(skipped).toBe(false)
  })

  it('applies route-based service override', () => {
    const { logger } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/auth/login',
      routes: {
        '/api/auth/**': { service: 'auth-service' },
      },
    })

    const ctx = logger.getContext()
    expect(ctx.service).toBe('auth-service')
  })

  it('finish() emits event with status', async () => {
    const { logger, finish } = createMiddlewareLogger({
      method: 'POST',
      path: '/api/checkout',
      requestId: 'req-456',
    })

    logger.set({ cart: { items: 3 } })
    const event = defined(await finish({ status: 200 }), 'finish event')

    expect(event.status).toBe(200)
    expect(event.method).toBe('POST')
    expect(event.path).toBe('/api/checkout')
    expect(event.duration).toBeDefined()
    expect(event.level).toBe('info')
  })

  it('finish() with error captures error and sets error status', async () => {
    const { finish } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/fail',
      requestId: 'req-789',
    })

    const error = Object.assign(new Error('Payment failed'), { status: 402 })
    const event = defined(await finish({ error }), 'finish event')

    expect(event.status).toBe(402)
    expect(event.level).toBe('error')
    expect(event.error).toBeDefined()
    expect((event.error as Record<string, unknown>).message).toBe('Payment failed')
  })

  it('finish() with error defaults to status 500', async () => {
    const { finish } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/fail',
    })

    const event = defined(await finish({ error: new Error('crash') }), 'finish event')

    expect(event.status).toBe(500)
  })

  it('finish() calls keep callback for tail sampling', async () => {
    const keep = vi.fn((ctx: { shouldKeep?: boolean }) => {
      ctx.shouldKeep = true
    })

    const { finish } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/important',
      keep,
    })

    await finish({ status: 200 })

    expect(keep).toHaveBeenCalledOnce()
    expect(keep).toHaveBeenCalledWith(expect.objectContaining({
      status: 200,
      path: '/api/important',
      method: 'GET',
      duration: expect.any(Number),
    }))
  })

  it('returns noop when logging is disabled', () => {
    initLogger({ enabled: false })

    const { skipped, logger } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/users',
    })

    expect(skipped).toBe(true)
    expect(logger.getContext()).toEqual({})
  })

  it('finish() on skipped logger returns null', async () => {
    const { finish, skipped } = createMiddlewareLogger({
      method: 'GET',
      path: '/health',
      include: ['/api/**'],
    })

    expect(skipped).toBe(true)
    const event = await finish({ status: 200 })
    expect(event).toBeNull()
  })

  it('accumulates context before finish', async () => {
    const { logger, finish } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/users',
    })

    logger.set({ user: { id: 'u-1' } })
    logger.set({ db: { queries: 3 } })

    const event = defined(await finish({ status: 200 }), 'finish event')

    expect((event.user as Record<string, unknown>).id).toBe('u-1')
    expect((event.db as Record<string, unknown>).queries).toBe(3)
  })

  it('finish() includes duration', async () => {
    const { finish } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/slow',
    })

    const event = defined(await finish({ status: 200 }), 'finish event')

    expect(event.duration).toBeDefined()
    expect(typeof event.duration).toBe('string')
    expect(typeof event.durationMs).toBe('number')
  })

  it('finish() with warn level when logger has warnings', async () => {
    const { logger, finish } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/warn',
    })

    logger.warn('Deprecated endpoint')
    const event = defined(await finish({ status: 200 }), 'finish event')

    expect(event.level).toBe('warn')
  })

  describe('built-in drain/enrich pipeline', () => {
    it('calls drain with emitted event and request info', async () => {
      const drain = vi.fn()

      const { logger, finish } = createMiddlewareLogger({
        method: 'POST',
        path: '/api/checkout',
        requestId: 'req-d1',
        headers: { 'user-agent': 'test-bot' },
        drain,
      })

      logger.set({ cart: { total: 99 } })
      await finish({ status: 200 })

      expect(drain).toHaveBeenCalledOnce()
      const [[ctx]] = drain.mock.calls
      expect(ctx.event.path).toBe('/api/checkout')
      expect(ctx.event.cart.total).toBe(99)
      expect(ctx.request).toEqual({ method: 'POST', path: '/api/checkout', requestId: 'req-d1' })
      expect(ctx.headers['user-agent']).toBe('test-bot')
    })

    it('calls enrich before drain and allows event mutation', async () => {
      const callOrder: string[] = []
      const enrich = vi.fn((ctx) => {
        callOrder.push('enrich')
        ctx.event.enriched = true
      })
      const drain = vi.fn((ctx) => {
        callOrder.push('drain')
        expect(ctx.event.enriched).toBe(true)
      })

      const { finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/test',
        enrich,
        drain,
      })

      await finish({ status: 200 })

      expect(callOrder).toEqual(['enrich', 'drain'])
    })

    it('enrich receives response status and headers', async () => {
      const enrich = vi.fn()

      const { finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/test',
        headers: { 'x-custom': 'value' },
        enrich,
      })

      await finish({ status: 201 })

      expect(enrich).toHaveBeenCalledOnce()
      const [[ctx]] = enrich.mock.calls
      expect(ctx.response.status).toBe(201)
      expect(ctx.headers['x-custom']).toBe('value')
    })

    it('drain error does not throw', async () => {
      const drain = vi.fn(() => {
        throw new Error('drain exploded')
      })

      const { finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/test',
        drain,
      })

      await expect(finish({ status: 200 })).resolves.not.toBeNull()
    })

    it('enrich error does not prevent drain', async () => {
      const drain = vi.fn()
      const enrich = vi.fn(() => {
        throw new Error('enrich exploded')
      })

      const { finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/test',
        enrich,
        drain,
      })

      await finish({ status: 200 })

      expect(drain).toHaveBeenCalledOnce()
    })

    it('falls back to global drain when no middleware drain is set', async () => {
      const globalDrain = vi.fn()
      initLogger({ pretty: false, drain: globalDrain })

      const { logger, finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/test',
        requestId: 'req-global',
      })

      logger.set({ action: 'global-drain-test' })
      await finish({ status: 200 })

      expect(globalDrain).toHaveBeenCalledOnce()
      const [[ctx]] = globalDrain.mock.calls
      expect(ctx.event.action).toBe('global-drain-test')
      expect(ctx.request).toEqual({ method: 'GET', path: '/api/test', requestId: 'req-global' })
    })

    it('middleware drain takes precedence over global drain', async () => {
      const globalDrain = vi.fn()
      const middlewareDrain = vi.fn()
      initLogger({ pretty: false, drain: globalDrain })

      const { finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/test',
        drain: middlewareDrain,
      })

      await finish({ status: 200 })

      expect(middlewareDrain).toHaveBeenCalledOnce()
      expect(globalDrain).not.toHaveBeenCalled()
    })

    it('does not double-drain when both global and middleware drain are set', async () => {
      const globalDrain = vi.fn()
      const middlewareDrain = vi.fn()
      initLogger({ pretty: false, drain: globalDrain })

      const { finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/test',
        drain: middlewareDrain,
      })

      await finish({ status: 200 })

      expect(middlewareDrain).toHaveBeenCalledOnce()
      expect(globalDrain).not.toHaveBeenCalled()
    })

    it('does not call drain/enrich when route is skipped', async () => {
      const drain = vi.fn()
      const enrich = vi.fn()

      const { finish, skipped } = createMiddlewareLogger({
        method: 'GET',
        path: '/health',
        include: ['/api/**'],
        drain,
        enrich,
      })

      expect(skipped).toBe(true)
      await finish({ status: 200 })

      expect(drain).not.toHaveBeenCalled()
      expect(enrich).not.toHaveBeenCalled()
    })

    it('calls drain on error with correct status', async () => {
      const drain = vi.fn()

      const { finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/fail',
        drain,
      })

      const error = Object.assign(new Error('fail'), { status: 422 })
      await finish({ error })

      expect(drain).toHaveBeenCalledOnce()
      const [[ctx]] = drain.mock.calls
      expect(ctx.event.status).toBe(422)
      expect(ctx.event.level).toBe('error')
    })

    it('works with keep + drain + enrich together', async () => {
      const keep = vi.fn((ctx) => {
        ctx.shouldKeep = true
      })
      const enrich = vi.fn((ctx) => {
        ctx.event.region = 'eu'
      })
      const drain = vi.fn()

      const { logger, finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/important',
        keep,
        enrich,
        drain,
      })

      logger.set({ important: true })
      const event = await finish({ status: 200 })

      expect(keep).toHaveBeenCalledOnce()
      expect(enrich).toHaveBeenCalledOnce()
      expect(drain).toHaveBeenCalledOnce()
      expect(event).not.toBeNull()
      expect(drain.mock.calls[0][0].event.region).toBe('eu')
    })
  })

  describe('waitUntil', () => {
    it('registers drain with waitUntil without awaiting drain completion', async () => {
      let drainSettled = false
      const drain = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
        drainSettled = true
      })
      const waitUntil = vi.fn()

      const { finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/test',
        drain,
        waitUntil,
      })

      await finish({ status: 200 })

      expect(waitUntil).toHaveBeenCalledOnce()
      expect(drainSettled).toBe(false)

      const [[scheduled]] = waitUntil.mock.calls
      await scheduled
      expect(drain).toHaveBeenCalledOnce()
      expect(drainSettled).toBe(true)
    })

    it('registers pipeline settled() with waitUntil so buffered batches are delivered', async () => {
      await withFakeTimers(async () => {
        const send = vi.fn().mockResolvedValue(undefined)
        const drain = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 1000 } })(send)
        const waitUntil = vi.fn()

        const { finish } = createMiddlewareLogger({
          method: 'GET',
          path: '/api/test',
          drain,
          waitUntil,
        })

        await finish({ status: 200 })

        expect(waitUntil).toHaveBeenCalledTimes(2)
        const [settledPromise] = defined(waitUntil.mock.calls[1], 'settled registration')
        let delivered = false
        void (settledPromise as Promise<void>).then(() => {
          delivered = true
        })

        await vi.advanceTimersByTimeAsync(0)
        expect(delivered).toBe(false)
        expect(send).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1000)
        expect(delivered).toBe(true)
        expect(send).toHaveBeenCalledTimes(1)
      })
    })

    it('still awaits enrich before registering waitUntil drain', async () => {
      let enrichDone = false
      const enrich = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        enrichDone = true
      })
      const drain = vi.fn()
      const waitUntil = vi.fn()

      const { finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/test',
        enrich,
        drain,
        waitUntil,
      })

      await finish({ status: 200 })

      expect(enrichDone).toBe(true)
      expect(waitUntil).toHaveBeenCalledOnce()
      const [[scheduled]] = waitUntil.mock.calls
      await scheduled
      expect(drain).toHaveBeenCalledOnce()
    })

    it('awaits drain when waitUntil is not provided', async () => {
      let drainSettled = false
      const drain = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        drainSettled = true
      })

      const { finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/test',
        drain,
      })

      await finish({ status: 200 })

      expect(drainSettled).toBe(true)
      expect(drain).toHaveBeenCalledOnce()
    })

    it('preserves this binding when calling waitUntil', async () => {
      const host = {
        waitUntil(promise: Promise<unknown>) {
          void promise
        },
      }
      const waitUntilSpy = vi.spyOn(host, 'waitUntil')
      const drain = vi.fn()

      const { finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/test',
        drain,
        waitUntil: host.waitUntil.bind(host),
      })

      await expect(finish({ status: 200 })).resolves.not.toThrow()
      expect(waitUntilSpy).toHaveBeenCalledOnce()
    })
  })

  describe('redact', () => {
    it('skips middleware redaction when initLogger already redacted the event', async () => {
      const { drain } = createPipelineSpies()
      initLogger({
        env: { service: 'test-app' },
        pretty: false,
        silent: true,
        redact: { builtins: ['email'] },
        drain,
      })

      const { logger, finish } = createMiddlewareLogger({
        method: 'GET',
        path: '/api/users',
        redact: { builtins: ['email'] },
      })
      logger.set({ contact: 'alice@example.com' })
      const event = defined(await finish({ status: 200 }), 'emitted event')

      expect(event.contact).toBe('a***@***.com')
      expect(Reflect.has(event, globallyRedacted)).toBe(true)
      await waitForDrainCalls(drain)
      expect(drain.mock.calls[0]![0].event.contact).toBe('a***@***.com')
    })
  })
})
