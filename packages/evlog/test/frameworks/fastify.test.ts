import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { initLogger } from '../../src/logger'
import { createError } from '../../src/error'
import type { RequestLogger } from '../../src/types'
import { evlog, useLogger } from '../../src/fastify/index'
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

describeStandardHttpMatrix({
  name: 'fastify',
  async mount(options) {
    const app = Fastify({ logger: false })
    await app.register(evlog, options)
    app.get('/api/users', () => ({ users: [] }))
    return {
      async fire(req) {
        const res = await app.inject({
          method: req.method || 'GET',
          url: req.path,
          headers: req.headers,
        })
        return { status: res.statusCode }
      },
      async cleanup() {
        await app.close()
      },
    }
  },
})

describe('evlog/fastify', () => {
  beforeEach(() => {
    initLogger({
      env: { service: 'fastify-test' },
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

  it('creates a logger accessible via request.log', async () => {
    const app = Fastify({ logger: false })
    await app.register(evlog)

    let hasLogger = false
    app.get('/api/test', (request) => {
      hasLogger = request.log !== undefined && typeof request.log.set === 'function'
      return { ok: true }
    })

    await app.inject({ method: 'GET', url: '/api/test' })
    expect(hasLogger).toBe(true)
  })

  it('accumulates context set by route handler', async () => {
    const { drain } = createPipelineSpies()
    const app = Fastify({ logger: false })
    await app.register(evlog, { drain })
    app.get('/api/users', () => {
      useLogger().set({ user: { id: 'u-1' }, db: { queries: 3 } })
      return { users: [] }
    })

    await app.inject({ method: 'GET', url: '/api/users' })
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
    const app = Fastify({ logger: false })
    await app.register(evlog, { drain })
    app.get('/api/turn', () => {
      throw createError({ message: 'Turn could not start', why: 'Agent queue is full' })
    })

    const res = await app.inject({ method: 'GET', url: '/api/turn' })
    await waitForDrainCalls(drain)

    expect(res.statusCode).toBe(500)
    assertHttpEventEmitted(drain, { path: '/api/turn', level: 'error', status: 500 })
  })

  it('logs error status when handler throws', async () => {
    const { drain } = createPipelineSpies()
    const app = Fastify({ logger: false })
    await app.register(evlog, { drain })
    app.get('/api/fail', () => {
      useLogger().error(new Error('Something broke'))
      const error = new Error('Something broke') as Error & { statusCode?: number }
      error.statusCode = 500
      throw error
    })

    await app.inject({ method: 'GET', url: '/api/fail' })
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/fail', level: 'error', status: 500 })
  })

  it('skips routes not matching include patterns', async () => {
    const app = Fastify({ logger: false })
    await app.register(evlog, { include: ['/api/**'] })

    let isEvlogLogger = false
    app.get('/health', (request) => {
      isEvlogLogger = typeof request.log?.set === 'function'
      return { ok: true }
    })

    await app.inject({ method: 'GET', url: '/health' })
    expect(isEvlogLogger).toBe(false)
  })

  it('logs routes matching include patterns', async () => {
    const { drain } = createPipelineSpies()
    const app = Fastify({ logger: false })
    await app.register(evlog, { include: ['/api/**'], drain })
    app.get('/api/data', () => {
      useLogger().set({ data: true })
      return { ok: true }
    })

    await app.inject({ method: 'GET', url: '/api/data' })
    await waitForDrainCalls(drain)

    expect(findEventViaDrain(drain, e => e.path === '/api/data')).toBeDefined()
  })

  it('handles POST requests with correct method', async () => {
    const { drain } = createPipelineSpies()
    const app = Fastify({ logger: false })
    await app.register(evlog, { drain })
    app.post('/api/checkout', () => ({ ok: true }))

    await app.inject({ method: 'POST', url: '/api/checkout' })
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/checkout', method: 'POST' })
  })

  it('excludes routes matching exclude patterns', async () => {
    const app = Fastify({ logger: false })
    await app.register(evlog, { exclude: ['/_internal/**'] })

    let isEvlogLogger = false
    app.get('/_internal/probe', (request) => {
      isEvlogLogger = typeof request.log?.set === 'function'
      return { ok: true }
    })

    await app.inject({ method: 'GET', url: '/_internal/probe' })
    expect(isEvlogLogger).toBe(false)
  })

  describe('drain / enrich / keep', () => {
    it('calls drain with emitted event (shared helpers)', async () => {
      const { drain } = createPipelineSpies()

      const app = Fastify({ logger: false })
      await app.register(evlog, { drain })
      app.get('/api/test', () => {
        useLogger().set({ user: { id: 'u-1' } })
        return { ok: true }
      })

      await app.inject({ method: 'GET', url: '/api/test' })

      assertDrainCalledWith(drain, { path: '/api/test', method: 'GET', level: 'info', status: 200 })
      const [[ctx]] = drain.mock.calls
      expect(ctx.headers).toBeDefined()
    })

    it('calls enrich before drain (shared helpers)', async () => {
      const { drain, enrich } = createPipelineSpies()
      enrich.mockImplementation((ctx) => {
        ctx.event.enriched = true
      })

      const app = Fastify({ logger: false })
      await app.register(evlog, { enrich, drain })
      app.get('/api/test', () => ({ ok: true }))

      await app.inject({ method: 'GET', url: '/api/test' })

      assertEnrichBeforeDrain(enrich, drain)
      expect(drain.mock.calls[0][0].event.enriched).toBe(true)
    })

    it('enrich receives response status and safe headers', async () => {
      const { enrich } = createPipelineSpies()

      const app = Fastify({ logger: false })
      await app.register(evlog, { enrich })
      app.get('/api/test', () => ({ ok: true }))

      await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: {
          'user-agent': 'test-bot/1.0',
          'x-custom': 'value',
        },
      })

      expect(enrich).toHaveBeenCalledOnce()
      const ctx = defined(enrich.mock.calls[0]?.[0], 'enrich context')
      expect(ctx.response?.status).toBe(200)
      expect(ctx.headers?.['user-agent']).toBe('test-bot/1.0')
      expect(ctx.headers?.['x-custom']).toBe('value')
    })

    it('filters sensitive headers (shared helpers)', async () => {
      const { drain } = createPipelineSpies()

      const app = Fastify({ logger: false })
      await app.register(evlog, { drain })
      app.get('/api/test', () => ({ ok: true }))

      await app.inject({
        method: 'GET',
        url: '/api/test',
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

      const app = Fastify({ logger: false })
      await app.register(evlog, { keep, drain })
      app.get('/api/test', () => {
        useLogger().set({ important: true })
        return { ok: true }
      })

      await app.inject({ method: 'GET', url: '/api/test' })

      expect(keep).toHaveBeenCalledOnce()
      expect(keep.mock.calls[0][0].path).toBe('/api/test')
      expect(drain).toHaveBeenCalledOnce()
    })

    it('drain error does not break request', async () => {
      const drain = vi.fn(() => {
        throw new Error('drain exploded')
      })

      const app = Fastify({ logger: false })
      await app.register(evlog, { drain })
      app.get('/api/test', () => ({ ok: true }))

      const res = await app.inject({ method: 'GET', url: '/api/test' })
      expect(res.statusCode).toBe(200)
      expect(drain).toHaveBeenCalledOnce()
    })

    it('enrich error does not prevent drain', async () => {
      const { drain } = createPipelineSpies()
      const enrich = vi.fn(() => {
        throw new Error('enrich exploded')
      })

      const app = Fastify({ logger: false })
      await app.register(evlog, { enrich, drain })
      app.get('/api/test', () => ({ ok: true }))

      const res = await app.inject({ method: 'GET', url: '/api/test' })
      expect(res.statusCode).toBe(200)
      expect(enrich).toHaveBeenCalledOnce()
      expect(drain).toHaveBeenCalledOnce()
    })

    it('does not call drain/enrich when route is skipped', async () => {
      const { drain, enrich } = createPipelineSpies()

      const app = Fastify({ logger: false })
      await app.register(evlog, { include: ['/api/**'], drain, enrich })
      app.get('/health', () => ({ ok: true }))

      await app.inject({ method: 'GET', url: '/health' })

      expect(drain).not.toHaveBeenCalled()
      expect(enrich).not.toHaveBeenCalled()
    })
  })

  describe('useLogger()', () => {
    it('returns the request-scoped logger from anywhere in the call stack', async () => {
      const { drain } = createPipelineSpies()
      const app = Fastify({ logger: false })
      await app.register(evlog, { drain })

      let loggerFromService: RequestLogger | undefined
      function serviceFunction() {
        loggerFromService = useLogger()
        useLogger().set({ fromService: true })
      }

      app.get('/api/test', () => {
        serviceFunction()
        return { ok: true }
      })

      await app.inject({ method: 'GET', url: '/api/test' })
      await waitForDrainCalls(drain)

      expect(loggerFromService).toBeDefined()
      expect(typeof defined(loggerFromService).set).toBe('function')

      const event = findEventViaDrain(drain, e => e.fromService === true)
      expect(event).toBeDefined()
    })

    it('returns the same logger as request.log', async () => {
      const app = Fastify({ logger: false })
      await app.register(evlog)

      let isSame = false
      app.get('/api/test', (request) => {
        isSame = useLogger() === defined(request.log, 'request.log in handler')
        return { ok: true }
      })

      await app.inject({ method: 'GET', url: '/api/test' })
      expect(isSame).toBe(true)
    })

    it('throws when called outside plugin context', () => {
      expect(() => useLogger()).toThrow('[evlog] useLogger()')
    })

    it('works across async boundaries', async () => {
      const { drain } = createPipelineSpies()
      const app = Fastify({ logger: false })
      await app.register(evlog, { drain })

      async function asyncService() {
        await new Promise(resolve => setTimeout(resolve, 5))
        useLogger().set({ asyncWork: 'done' })
      }

      app.get('/api/test', async () => {
        await asyncService()
        return { ok: true }
      })

      await app.inject({ method: 'GET', url: '/api/test' })
      await waitForDrainCalls(drain)

      const event = findEventViaDrain(drain, e => e.asyncWork === 'done')
      expect(event).toBeDefined()
    })
  })
})
