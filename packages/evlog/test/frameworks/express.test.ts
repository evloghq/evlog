import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { initLogger } from '../../src/logger'
import { createError } from '../../src/error'
import type { RequestLogger } from '../../src/types'
import { evlog, useLogger } from '../../src/express/index'
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
  name: 'express',
  mount(options) {
    const app = express()
    app.use(evlog(options))
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

describe('evlog/express', () => {
  beforeEach(() => {
    initLogger({
      env: { service: 'express-test' },
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

  it('creates a logger accessible via req.log', async () => {
    const app = express()
    app.use(evlog())

    let hasLogger = false
    app.get('/api/test', (req, res) => {
      hasLogger = req.log !== undefined && typeof req.log.set === 'function'
      res.json({ ok: true })
    })

    await request(app).get('/api/test')
    expect(hasLogger).toBe(true)
  })

  it('accumulates context set by route handler', async () => {
    const { drain } = createPipelineSpies()
    const app = express()
    app.use(evlog({ drain }))
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

  it('answers 500 for a thrown EvlogError without a status', async () => {
    const { drain } = createPipelineSpies()
    const app = express()
    app.use(evlog({ drain }))
    app.get('/api/turn', () => {
      throw createError({ message: 'Turn could not start', why: 'Agent queue is full' })
    })

    const res = await request(app).get('/api/turn')
    await waitForDrainCalls(drain)

    expect(res.status).toBe(500)
    assertHttpEventEmitted(drain, { path: '/api/turn', status: 500 })
  })

  it('logs error status when handler sends error response', async () => {
    const { drain } = createPipelineSpies()
    const app = express()
    app.use(evlog({ drain }))
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
    app.use(evlog({ include: ['/api/**'] }))

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
    app.use(evlog({ include: ['/api/**'], drain }))
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
    app.use(evlog({ drain }))
    app.post('/api/checkout', (_req, res) => res.json({ ok: true }))

    await request(app).post('/api/checkout')
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/checkout', method: 'POST' })
  })

  it('excludes routes matching exclude patterns', async () => {
    const app = express()
    app.use(evlog({ exclude: ['/_internal/**'] }))

    let logValue: unknown = 'untouched'
    app.get('/_internal/probe', (req, res) => {
      logValue = req.log
      res.json({ ok: true })
    })

    await request(app).get('/_internal/probe')
    expect(logValue).toBeUndefined()
  })

  describe('drain / enrich / keep', () => {
    it('calls drain with emitted event (shared helpers)', async () => {
      const { drain } = createPipelineSpies()

      const app = express()
      app.use(evlog({ drain }))
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
      app.use(evlog({ enrich, drain }))
      app.get('/api/test', (_req, res) => res.json({ ok: true }))

      await request(app).get('/api/test')

      assertEnrichBeforeDrain(enrich, drain)
      expect(drain.mock.calls[0][0].event.enriched).toBe(true)
    })

    it('enrich receives response status and safe headers', async () => {
      const { enrich } = createPipelineSpies()

      const app = express()
      app.use(evlog({ enrich }))
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
      app.use(evlog({ drain }))
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
      app.use(evlog({ keep, drain }))
      app.get('/api/test', (_req, res) => {
        useLogger().set({ important: true })
        res.json({ ok: true })
      })

      await request(app).get('/api/test')

      expect(keep).toHaveBeenCalledOnce()
      expect(keep.mock.calls[0][0].path).toBe('/api/test')
      expect(drain).toHaveBeenCalledOnce()
    })

    it('calls drain on error responses', async () => {
      const { drain } = createPipelineSpies()

      const app = express()
      app.use(evlog({ drain }))
      app.get('/api/fail', (_req, res) => {
        useLogger().error(new Error('something broke'))
        res.status(500).json({ error: 'fail' })
      })

      await request(app).get('/api/fail')

      assertDrainCalledWith(drain, { path: '/api/fail', level: 'error', status: 500 })
    })

    it('drain error does not break request', async () => {
      const drain = vi.fn(() => {
        throw new Error('drain exploded')
      })

      const app = express()
      app.use(evlog({ drain }))
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
      app.use(evlog({ enrich, drain }))
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
      app.use(evlog({ include: ['/api/**'], drain, enrich }))
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
      app.use(evlog({ drain }))

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
      app.use(evlog())

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
      app.use(evlog({ drain }))

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
    /**
     * Boot a real HTTP server, fire a request, abort it before the handler
     * finishes, then wait for the listener to settle. Avoids supertest, which
     * always lets the handler complete.
     */
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
      app.use(evlog({ drain }))
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
      expect(event.step).toBe('before-sleep')
    })

    it('does not flag connectionClosed when the response completes normally', async () => {
      const { drain } = createPipelineSpies()
      const app = express()
      app.use(evlog({ drain }))
      app.get('/api/fast', (_req, res) => res.json({ ok: true }))

      await request(app).get('/api/fast')
      await waitForDrainCalls(drain)

      const event = defined(
        findEventViaDrain(drain, e => e.path === '/api/fast'),
        'normal completion event',
      )
      expect(event.connectionClosed).toBeUndefined()
      expect(event.status).toBe(200)
    })

    it('runs drain exactly once when the client aborts mid-handler', async () => {
      const { drain } = createPipelineSpies()

      const app = express()
      app.use(evlog({ drain }))
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
