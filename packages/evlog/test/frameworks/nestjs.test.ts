import http from 'node:http'
import type { MiddlewareConsumer } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express, { type RequestHandler } from 'express'
import request from 'supertest'
import { initLogger } from '../../src/logger'
import { EvlogModule, useLogger } from '../../src/nestjs/index'
import type { EvlogNestJSOptions } from '../../src/nestjs/index'
import type { RequestLogger } from '../../src/types'
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

type MiddlewareProxyStub = {
  forRoutes: (...routes: unknown[]) => MiddlewareConsumer
  exclude: (...routes: unknown[]) => MiddlewareProxyStub
}

/** Minimal {@link MiddlewareConsumer} stub that captures the applied middleware. */
function createMiddlewareConsumerCapture(onApply: (mw: RequestHandler) => void): MiddlewareConsumer {
  const proxy: MiddlewareProxyStub = {
    forRoutes: () => consumer,
    exclude: () => proxy,
  }

  const consumer = {
    apply: ((mw: unknown) => {
      onApply(mw as RequestHandler)
      return proxy
    }) as MiddlewareConsumer['apply'],
  } satisfies Pick<MiddlewareConsumer, 'apply'>

  return consumer as MiddlewareConsumer
}

/**
 * Extract the middleware function from EvlogModule.configure() for testing.
 * This lets us test the actual middleware pipeline through the NestJS module API
 * without needing the full NestJS runtime.
 */
function getMiddleware(options: EvlogNestJSOptions = {}): RequestHandler {
  let middleware: RequestHandler | undefined

  EvlogModule.forRoot(options)
  const module = new EvlogModule()
  module.configure(createMiddlewareConsumerCapture((mw) => {
    middleware = mw
  }))
  return defined(middleware, 'evlog middleware from configure()')
}

describeStandardHttpMatrix({
  name: 'nestjs',
  mount(options) {
    const app = express()
    app.use(getMiddleware(options))
    app.get('/api/users', (_req, res) => res.json({ users: [] }))
    return Promise.resolve({
      async fire(req) {
        const method = (req.method || 'GET').toLowerCase()
        const agent = method === 'post'
          ? request(app).post(req.path)
          : request(app).get(req.path)
        for (const [k, v] of Object.entries(req.headers || {})) agent.set(k, v)
        const res = await agent
        return { status: res.status }
      },
    })
  },
})

describe('evlog/nestjs', () => {
  beforeEach(() => {
    initLogger({
      env: { service: 'nestjs-test' },
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

  describe('EvlogModule', () => {
    it('forRoot() returns a valid DynamicModule', () => {
      const result = EvlogModule.forRoot({ exclude: ['/health'] })
      expect(result).toHaveProperty('module', EvlogModule)
      expect(result).toHaveProperty('global', true)
    })

    it('forRootAsync() returns a valid DynamicModule with providers', () => {
      const result = EvlogModule.forRootAsync({
        useFactory: () => ({ exclude: ['/health'] }),
      })
      expect(result).toHaveProperty('module', EvlogModule)
      expect(result).toHaveProperty('global', true)
      expect(result.providers).toMatchObject([
        { provide: 'EVLOG_OPTIONS' },
        { provide: 'EVLOG_FASTIFY_REQUEST_LOG' },
      ])
    })

    it('forRootAsync() includes imports when provided', () => {
      const fakeModule = class ConfigModule {}
      const result = EvlogModule.forRootAsync({
        imports: [fakeModule],
        useFactory: () => ({}),
        inject: ['CONFIG'],
      })
      expect(result.imports).toContain(fakeModule)
    })

    it('configure() applies middleware via consumer', () => {
      const forRoutes = vi.fn()
      const proxy: MiddlewareProxyStub = {
        forRoutes,
        exclude: vi.fn(() => proxy),
      }
      const apply = vi.fn<(mw: unknown) => MiddlewareProxyStub>(() => proxy)
      const consumer = { apply: apply as MiddlewareConsumer['apply'] } satisfies Pick<MiddlewareConsumer, 'apply'>

      EvlogModule.forRoot()
      const module = new EvlogModule()
      module.configure(consumer as MiddlewareConsumer)

      expect(apply).toHaveBeenCalledOnce()
      expect(defined(apply.mock.calls[0], 'apply call')[0]).toBeTypeOf('function')
      expect(forRoutes).toHaveBeenCalledWith('*')
    })
  })

  describe('middleware behavior', () => {
    it('creates a logger accessible via req.log', async () => {
      const app = express()
      app.use(getMiddleware())

      let hasLogger = false
      app.get('/api/test', (req, res) => {
        hasLogger = req.log !== undefined && typeof defined(req.log).set === 'function'
        res.json({ ok: true })
      })

      await request(app).get('/api/test')
      expect(hasLogger).toBe(true)
    })

    it('accumulates context set by route handler', async () => {
      const { drain } = createPipelineSpies()
      const app = express()
      app.use(getMiddleware({ drain }))
      app.get('/api/users', (_req, res) => {
        useLogger().set({ user: { id: 'u-1' }, db: { queries: 3 } })
        res.json({ users: [] })
      })

      await request(app).get('/api/users')
      await waitForDrainCalls(drain)

      const event = defined(
        findEventViaDrain(drain, e => e.path === '/api/users'),
        'accumulated context event',
      )
      expect(event.user).toEqual({ id: 'u-1' })
      expect(event.db).toEqual({ queries: 3 })
    })

    it('logs error status when handler sends error response', async () => {
      const { drain } = createPipelineSpies()
      const app = express()
      app.use(getMiddleware({ drain }))
      app.get('/api/fail', (_req, res) => {
        useLogger().error(new Error('Something broke'))
        res.status(500).json({ error: 'fail' })
      })

      await request(app).get('/api/fail')
      await waitForDrainCalls(drain)

      assertHttpEventEmitted(drain, {
        path: '/api/fail',
        level: 'error',
        status: 500,
      })
    })

    it('skips routes not matching include patterns', async () => {
      const app = express()
      app.use(getMiddleware({ include: ['/api/**'] }))

      let logValue: unknown = 'untouched'
      app.get('/health', (req, res) => {
        logValue = req.log
        res.json({ ok: true })
      })

      await request(app).get('/health')
      expect(logValue).toBeUndefined()
    })

    it('logs routes matching include patterns', async () => {
      const { drain } = createPipelineSpies()
      const app = express()
      app.use(getMiddleware({ include: ['/api/**'], drain }))
      app.get('/api/data', (_req, res) => {
        useLogger().set({ data: true })
        res.json({ ok: true })
      })

      await request(app).get('/api/data')
      await waitForDrainCalls(drain)

      expect(findEventViaDrain(drain, e => e.path === '/api/data')).toBeDefined()
    })

    it('handles POST requests with correct method', async () => {
      const { drain } = createPipelineSpies()
      const app = express()
      app.use(getMiddleware({ drain }))
      app.post('/api/checkout', (_req, res) => res.json({ ok: true }))

      await request(app).post('/api/checkout')
      await waitForDrainCalls(drain)

      assertHttpEventEmitted(drain, { path: '/api/checkout', method: 'POST' })
    })

    it('excludes routes matching exclude patterns', async () => {
      const app = express()
      app.use(getMiddleware({ exclude: ['/_internal/**'] }))

      let logValue: unknown = 'untouched'
      app.get('/_internal/probe', (req, res) => {
        logValue = req.log
        res.json({ ok: true })
      })

      await request(app).get('/_internal/probe')
      expect(logValue).toBeUndefined()
    })
  })

  describe('drain / enrich / keep', () => {
    it('calls drain with emitted event (shared helpers)', async () => {
      const { drain } = createPipelineSpies()

      const app = express()
      app.use(getMiddleware({ drain }))
      app.get('/api/test', (_req, res) => {
        useLogger().set({ user: { id: 'u-1' } })
        res.json({ ok: true })
      })

      await request(app).get('/api/test')

      assertDrainCalledWith(drain, { path: '/api/test', method: 'GET', level: 'info', status: 200 })
      const [[ctx]] = drain.mock.calls
      expect(ctx.headers).toBeDefined()
    })

    it('calls enrich before drain (shared helpers)', async () => {
      const { drain, enrich } = createPipelineSpies()
      enrich.mockImplementation((ctx) => {
        ctx.event.enriched = true
      })

      const app = express()
      app.use(getMiddleware({ enrich, drain }))
      app.get('/api/test', (_req, res) => res.json({ ok: true }))

      await request(app).get('/api/test')

      assertEnrichBeforeDrain(enrich, drain)
      expect(drain.mock.calls[0][0].event.enriched).toBe(true)
    })

    it('enrich receives response status and safe headers', async () => {
      const { enrich } = createPipelineSpies()

      const app = express()
      app.use(getMiddleware({ enrich }))
      app.get('/api/test', (_req, res) => res.json({ ok: true }))

      await request(app)
        .get('/api/test')
        .set('user-agent', 'test-bot/1.0')
        .set('x-custom', 'value')

      expect(enrich).toHaveBeenCalledOnce()
      const ctx = defined(enrich.mock.calls[0]?.[0], 'enrich context')
      expect(ctx.response?.status).toBe(200)
      expect(ctx.headers?.['user-agent']).toBe('test-bot/1.0')
      expect(ctx.headers?.['x-custom']).toBe('value')
    })

    it('filters sensitive headers (shared helpers)', async () => {
      const { drain } = createPipelineSpies()

      const app = express()
      app.use(getMiddleware({ drain }))
      app.get('/api/test', (_req, res) => res.json({ ok: true }))

      await request(app)
        .get('/api/test')
        .set('authorization', 'Bearer secret-token')
        .set('cookie', 'session=abc')
        .set('x-safe', 'visible')

      const ctx = getDrainCallArg(defined(drain.mock.calls[0], 'drain call'))
      assertSensitiveHeadersFiltered(ctx)
      expect(ctx.headers?.['x-safe']).toBe('visible')
    })

    it('calls keep callback for tail sampling', async () => {
      const { keep, drain } = createPipelineSpies()
      keep.mockImplementation((ctx) => {
        if (ctx.context.important) ctx.shouldKeep = true
      })

      const app = express()
      app.use(getMiddleware({ keep, drain }))
      app.get('/api/test', (_req, res) => {
        useLogger().set({ important: true })
        res.json({ ok: true })
      })

      await request(app).get('/api/test')

      expect(keep).toHaveBeenCalledOnce()
      expect(keep.mock.calls[0][0].path).toBe('/api/test')
      expect(drain).toHaveBeenCalledOnce()
    })

    it('drain error does not break request', async () => {
      const drain = vi.fn(() => {
        throw new Error('drain exploded')
      })

      const app = express()
      app.use(getMiddleware({ drain }))
      app.get('/api/test', (_req, res) => res.json({ ok: true }))

      const res = await request(app).get('/api/test')
      expect(res.status).toBe(200)
      expect(drain).toHaveBeenCalledOnce()
    })

    it('enrich error does not prevent drain', async () => {
      const { drain } = createPipelineSpies()
      const enrich = vi.fn(() => {
        throw new Error('enrich exploded')
      })

      const app = express()
      app.use(getMiddleware({ enrich, drain }))
      app.get('/api/test', (_req, res) => res.json({ ok: true }))

      const res = await request(app).get('/api/test')
      expect(res.status).toBe(200)
      expect(enrich).toHaveBeenCalledOnce()
      await waitForDrainCalls(drain)
      expect(drain).toHaveBeenCalledOnce()
    })

    it('does not call drain/enrich when route is skipped', async () => {
      const { drain, enrich } = createPipelineSpies()

      const app = express()
      app.use(getMiddleware({ include: ['/api/**'], drain, enrich }))
      app.get('/health', (_req, res) => res.json({ ok: true }))

      await request(app).get('/health')

      expect(drain).not.toHaveBeenCalled()
      expect(enrich).not.toHaveBeenCalled()
    })
  })

  describe('useLogger()', () => {
    it('returns the request-scoped logger from anywhere in the call stack', async () => {
      const { drain } = createPipelineSpies()
      const app = express()
      app.use(getMiddleware({ drain }))

      let loggerFromService: RequestLogger | undefined
      function serviceFunction() {
        loggerFromService = useLogger()
        useLogger().set({ fromService: true })
      }

      app.get('/api/test', (_req, res) => {
        serviceFunction()
        res.json({ ok: true })
      })

      await request(app).get('/api/test')
      await waitForDrainCalls(drain)

      expect(loggerFromService).toBeDefined()
      expect(typeof defined(loggerFromService).set).toBe('function')

      const event = findEventViaDrain(drain, e => e.fromService === true)
      expect(event).toBeDefined()
    })

    it('returns the same logger as req.log', async () => {
      const app = express()
      app.use(getMiddleware())

      let isSame = false
      app.get('/api/test', (req, res) => {
        isSame = useLogger() === defined(req.log, 'req.log in middleware')
        res.json({ ok: true })
      })

      await request(app).get('/api/test')
      expect(isSame).toBe(true)
    })

    it('throws when called outside middleware context', () => {
      expect(() => useLogger()).toThrow('[evlog] useLogger()')
    })

    it('works across async boundaries', async () => {
      const { drain } = createPipelineSpies()
      const app = express()
      app.use(getMiddleware({ drain }))

      async function asyncService() {
        await new Promise(resolve => setTimeout(resolve, 5))
        useLogger().set({ asyncWork: 'done' })
      }

      app.get('/api/test', async (_req, res) => {
        await asyncService()
        res.json({ ok: true })
      })

      await request(app).get('/api/test')
      await waitForDrainCalls(drain)

      const event = findEventViaDrain(drain, e => e.asyncWork === 'done')
      expect(event).toBeDefined()
    })
  })

  describe('client disconnect', () => {
    async function abortMidRequest(app: express.Express, path: string, abortAfterMs: number): Promise<void> {
      const server = app.listen(0)
      await new Promise<void>(resolve => server.once('listening', resolve))
      try {
        const address = server.address()
        if (!address || typeof address === 'string') {
          throw new Error('Failed to bind test server to an ephemeral port')
        }
        const { port } = address
        const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' })
        req.on('error', () => {})
        req.end()
        await new Promise(resolve => setTimeout(resolve, abortAfterMs))
        req.destroy()
        await new Promise(resolve => setTimeout(resolve, 60))
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    }

    it('emits the wide event with connectionClosed=true when the client aborts mid-handler', async () => {
      const { drain } = createPipelineSpies()
      const app = express()
      app.use(getMiddleware({ drain }))
      app.get('/api/slow', async (_req, res) => {
        useLogger().set({ step: 'before-sleep' })
        await new Promise(resolve => setTimeout(resolve, 100))
        useLogger().set({ step: 'after-sleep' })
        res.json({ ok: true })
      })

      await abortMidRequest(app, '/api/slow', 20)
      await waitForDrainCalls(drain)

      const event = defined(
        findEventViaDrain(drain, e => e.path === '/api/slow'),
        'connectionClosed event',
      )
      expect(event.connectionClosed).toBe(true)
      expect(event.method).toBe('GET')
      expect(event.path).toBe('/api/slow')
      expect(event.step).toBe('before-sleep')
    })

    it('runs drain exactly once when the client aborts mid-handler', async () => {
      const { drain } = createPipelineSpies()

      const app = express()
      app.use(getMiddleware({ drain }))
      app.get('/api/slow', async (_req, res) => {
        await new Promise(resolve => setTimeout(resolve, 100))
        res.json({ ok: true })
      })

      await abortMidRequest(app, '/api/slow', 20)

      expect(drain).toHaveBeenCalledTimes(1)
      const [[ctx]] = drain.mock.calls
      expect(ctx.event.connectionClosed).toBe(true)
      expect(ctx.event.path).toBe('/api/slow')
    })
  })
})
