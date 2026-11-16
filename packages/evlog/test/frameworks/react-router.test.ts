import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterContextProvider } from 'react-router'
import { initLogger } from '../../src/logger'
import type { RequestLogger } from '../../src/types'
import { evlog, loggerContext, useLogger } from '../../src/react-router/index'
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

function createMockContext(): RouterContextProvider {
  return new RouterContextProvider()
}

function createRequest(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, init)
}

function okResponse() {
  return Promise.resolve(new Response('ok', { status: 200 }))
}

describeStandardHttpMatrix({
  name: 'react-router',
  mount(options) {
    const middleware = evlog(options)
    return Promise.resolve({
      async fire(req) {
        const context = createMockContext()
        const next = vi.fn(() => okResponse())
        await middleware({
          request: createRequest(req.path, { method: req.method || 'GET', headers: req.headers }),
          context,
        }, next)
        return { status: 200 }
      },
    })
  },
})

describe('evlog/react-router', () => {
  beforeEach(() => {
    initLogger({
      env: { service: 'react-router-test' },
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

  it('creates a logger accessible via context.get(loggerContext)', async () => {
    const middleware = evlog()
    const context = createMockContext()
    const next = vi.fn(() => okResponse())

    await middleware({ request: createRequest('/api/test'), context }, next)

    const logger = context.get(loggerContext)
    expect(logger).toBeDefined()
    expect(typeof logger.set).toBe('function')
  })

  it('accumulates context set by loader', async () => {
    const { drain } = createPipelineSpies()
    const middleware = evlog({ drain })
    const context = createMockContext()
    const next = vi.fn(() => {
      useLogger().set({ user: { id: 'u-1' }, db: { queries: 3 } })
      return okResponse()
    })

    await middleware({ request: createRequest('/api/users'), context }, next)
    await waitForDrainCalls(drain)

    const event = defined(
      findEventViaDrain(drain, e => e.path === '/api/users'),
      'accumulated context event',
    )
    expect(event.user).toEqual({ id: 'u-1' })
    expect(event.db).toEqual({ queries: 3 })
  })

  it('logs status 500 when handler throws', async () => {
    const { drain } = createPipelineSpies()
    const middleware = evlog({ drain })
    const context = createMockContext()
    const next = vi.fn(() => Promise.reject(new Error('Something broke')))

    await expect(
      middleware({ request: createRequest('/api/fail'), context }, next),
    ).rejects.toThrow('Something broke')
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, {
      path: '/api/fail',
      status: 500,
    })
  })

  it('re-throws all errors from handler', async () => {
    const middleware = evlog()
    const context = createMockContext()
    const next = vi.fn(() => Promise.reject(new TypeError('unexpected')))

    await expect(
      middleware({ request: createRequest('/api/fail'), context }, next),
    ).rejects.toThrow('unexpected')
  })

  it('gives routes not matching include patterns a logger that does nothing', async () => {
    const { drain } = createPipelineSpies()
    const middleware = evlog({ include: ['/api/**'], drain })
    const context = createMockContext()
    const next = vi.fn(() => {
      context.get(loggerContext).set({ probe: true })
      return okResponse()
    })

    await middleware({ request: createRequest('/health'), context }, next)

    expect(next).toHaveBeenCalledOnce()
    expect(drain).not.toHaveBeenCalled()
    expect(context.get(loggerContext).getContext()).toEqual({})
  })

  it('logs routes matching include patterns', async () => {
    const { drain } = createPipelineSpies()
    const middleware = evlog({ include: ['/api/**'], drain })
    const context = createMockContext()
    const next = vi.fn(() => okResponse())

    await middleware({ request: createRequest('/api/data'), context }, next)
    await waitForDrainCalls(drain)

    expect(findEventViaDrain(drain, e => e.path === '/api/data')).toBeDefined()
  })

  it('handles POST requests with correct method', async () => {
    const { drain } = createPipelineSpies()
    const middleware = evlog({ drain })
    const context = createMockContext()
    const next = vi.fn(() => okResponse())

    await middleware({
      request: createRequest('/api/checkout', { method: 'POST' }),
      context,
    }, next)
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/checkout', method: 'POST' })
  })

  it('gives routes matching exclude patterns a logger that does nothing', async () => {
    const { drain } = createPipelineSpies()
    const middleware = evlog({ exclude: ['/_internal/**'], drain })
    const context = createMockContext()
    const next = vi.fn(() => {
      context.get(loggerContext).set({ probe: true })
      return okResponse()
    })

    await middleware({ request: createRequest('/_internal/probe'), context }, next)

    expect(next).toHaveBeenCalledOnce()
    expect(drain).not.toHaveBeenCalled()
    expect(context.get(loggerContext).getContext()).toEqual({})
  })

  it('gives loaders a logger that does nothing with enabled: false', async () => {
    initLogger({ enabled: false })
    const middleware = evlog()
    const context = createMockContext()
    const next = vi.fn(() => {
      context.get(loggerContext).set({ user: { id: 'u_1' } })
      return okResponse()
    })

    const response = await middleware({ request: createRequest('/orders'), context }, next)

    expect(response.status).toBe(200)
    expect(context.get(loggerContext).getContext()).toEqual({})
  })

  describe('drain / enrich / keep', () => {
    it('calls drain with emitted event (shared helpers)', async () => {
      const { drain } = createPipelineSpies()

      const middleware = evlog({ drain })
      const context = createMockContext()
      const next = vi.fn(() => {
        useLogger().set({ user: { id: 'u-1' } })
        return okResponse()
      })

      await middleware({ request: createRequest('/api/test'), context }, next)

      assertDrainCalledWith(drain, { path: '/api/test', method: 'GET', level: 'info', status: 200 })
      const [[ctx]] = drain.mock.calls
      expect(ctx.headers).toBeDefined()
    })

    it('calls enrich before drain (shared helpers)', async () => {
      const { drain, enrich } = createPipelineSpies()
      enrich.mockImplementation((ctx) => {
        ctx.event.enriched = true
      })

      const middleware = evlog({ enrich, drain })
      const context = createMockContext()
      const next = vi.fn(() => okResponse())

      await middleware({ request: createRequest('/api/test'), context }, next)

      assertEnrichBeforeDrain(enrich, drain)
      expect(drain.mock.calls[0][0].event.enriched).toBe(true)
    })

    it('enrich receives response status and safe headers', async () => {
      const { enrich } = createPipelineSpies()

      const middleware = evlog({ enrich })
      const context = createMockContext()
      const next = vi.fn(() => okResponse())

      await middleware({
        request: createRequest('/api/test', {
          headers: { 'user-agent': 'test-bot/1.0', 'x-custom': 'value' },
        }),
        context,
      }, next)

      expect(enrich).toHaveBeenCalledOnce()
      const ctx = defined(enrich.mock.calls[0]?.[0], 'enrich context')
      expect(ctx.response?.status).toBe(200)
      expect(ctx.headers?.['user-agent']).toBe('test-bot/1.0')
      expect(ctx.headers?.['x-custom']).toBe('value')
    })

    it('filters sensitive headers (shared helpers)', async () => {
      const { drain } = createPipelineSpies()

      const middleware = evlog({ drain })
      const context = createMockContext()
      const next = vi.fn(() => okResponse())

      await middleware({
        request: createRequest('/api/test', {
          headers: {
            'authorization': 'Bearer secret-token',
            'cookie': 'session=abc',
            'x-safe': 'visible',
          },
        }),
        context,
      }, next)

      const ctx = getDrainCallArg(defined(drain.mock.calls[0], 'drain call'))
      assertSensitiveHeadersFiltered(ctx)
      expect(ctx.headers?.['x-safe']).toBe('visible')
    })

    it('calls keep callback for tail sampling', async () => {
      const { keep, drain } = createPipelineSpies()
      keep.mockImplementation((ctx) => {
        if (ctx.context.important) ctx.shouldKeep = true
      })

      const middleware = evlog({ keep, drain })
      const context = createMockContext()
      const next = vi.fn(() => {
        useLogger().set({ important: true })
        return okResponse()
      })

      await middleware({ request: createRequest('/api/test'), context }, next)

      expect(keep).toHaveBeenCalledOnce()
      expect(keep.mock.calls[0][0].path).toBe('/api/test')
      expect(drain).toHaveBeenCalledOnce()
    })

    it('calls drain on error responses', async () => {
      const { drain } = createPipelineSpies()

      const middleware = evlog({ drain })
      const context = createMockContext()
      const next = vi.fn(() => {
        useLogger().error(new Error('something broke'))
        return Promise.resolve(new Response('error', { status: 500 }))
      })

      await middleware({ request: createRequest('/api/fail'), context }, next)

      assertDrainCalledWith(drain, { path: '/api/fail', level: 'error', status: 500 })
    })

    it('drain error does not break request', async () => {
      const drain = vi.fn(() => {
        throw new Error('drain exploded')
      })

      const middleware = evlog({ drain })
      const context = createMockContext()
      const next = vi.fn(() => okResponse())

      const response = await middleware({ request: createRequest('/api/test'), context }, next)
      expect(response.status).toBe(200)
      expect(drain).toHaveBeenCalledOnce()
    })

    it('enrich error does not prevent drain', async () => {
      const { drain } = createPipelineSpies()
      const enrich = vi.fn(() => {
        throw new Error('enrich exploded')
      })

      const middleware = evlog({ enrich, drain })
      const context = createMockContext()
      const next = vi.fn(() => okResponse())

      const response = await middleware({ request: createRequest('/api/test'), context }, next)
      expect(response.status).toBe(200)
      expect(enrich).toHaveBeenCalledOnce()
      expect(drain).toHaveBeenCalledOnce()
    })

    it('does not call drain/enrich when route is skipped', async () => {
      const { drain, enrich } = createPipelineSpies()

      const middleware = evlog({ include: ['/api/**'], drain, enrich })
      const context = createMockContext()
      const next = vi.fn(() => okResponse())

      await middleware({ request: createRequest('/health'), context }, next)

      expect(drain).not.toHaveBeenCalled()
      expect(enrich).not.toHaveBeenCalled()
    })
  })

  describe('useLogger', () => {
    it('returns same logger in middleware context', async () => {
      let loggerFromUseLogger: RequestLogger | undefined

      const middleware = evlog()
      const context = createMockContext()
      const next = vi.fn(() => {
        loggerFromUseLogger = useLogger()
        return okResponse()
      })

      await middleware({ request: createRequest('/api/test'), context }, next)

      const loggerFromContext = context.get(loggerContext)
      expect(loggerFromUseLogger).toBe(loggerFromContext)
    })

    it('throws outside middleware context', () => {
      expect(() => useLogger()).toThrow('[evlog] useLogger()')
    })

    it('works across async boundaries', async () => {
      let loggerFromAsync: RequestLogger | undefined

      const middleware = evlog()
      const context = createMockContext()
      const next = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 1))
        loggerFromAsync = useLogger()
        return new Response('ok', { status: 200 })
      })

      await middleware({ request: createRequest('/api/test'), context }, next)

      expect(typeof defined(loggerFromAsync).set).toBe('function')
    })
  })
})
