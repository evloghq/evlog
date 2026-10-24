import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EvlogError } from '../../src/error'
import { initWorkersLogger, withEvlog } from '../../src/workers'
import {
  assertHttpEventEmitted,
  createPipelineSpies,
  findEventViaDrain,
  waitForDrainCalls,
} from '../helpers/framework'
import { defined } from '../helpers/defined'
import { describeStandardHttpMatrix } from '../helpers/frameworkMatrix'
import { createDeferredStream } from '../helpers/stream'

function fireWorker(
  worker: { fetch: (r: Request, e: unknown, c: { waitUntil: (p: Promise<unknown>) => void }) => Promise<Response> },
  req: { method?: string, path: string, headers?: Record<string, string> },
  executionCtx: { waitUntil: (p: Promise<unknown>) => void } = { waitUntil: () => {} },
): Promise<Response> {
  return worker.fetch(
    new Request(`https://example.com${req.path}`, { method: req.method || 'GET', headers: req.headers }),
    {},
    executionCtx,
  )
}

describeStandardHttpMatrix({
  name: 'workers',
  mount(options) {
    const worker = withEvlog(() => new Response(JSON.stringify({ users: [] }), { status: 200 }), options)
    return Promise.resolve({
      async fire(req) {
        const res = await fireWorker(worker, req)
        return { status: res.status }
      },
    })
  },
})

describe('evlog/workers withEvlog', () => {
  beforeEach(() => {
    initWorkersLogger({ env: { service: 'workers-test' } })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits without the handler calling log.emit()', async () => {
    const { drain } = createPipelineSpies()
    const worker = withEvlog((_req, _env, _ctx, log) => {
      log.set({ route: 'health' })
      return new Response('ok')
    }, { drain })

    await fireWorker(worker, { path: '/api/health' })
    await waitForDrainCalls(drain)

    const event = assertHttpEventEmitted(drain, { path: '/api/health', method: 'GET', status: 200 })
    expect(event.route).toBe('health')
  })

  it('carries Cloudflare context onto the event', async () => {
    const { drain } = createPipelineSpies()
    const worker = withEvlog(() => new Response('ok'), { drain })

    await fireWorker(worker, { path: '/api/x', headers: { 'cf-ray': 'ray-abc' } })
    await waitForDrainCalls(drain)

    const event = defined(findEventViaDrain(drain, e => e.path === '/api/x'), 'cf event')
    expect(event.cfRay).toBe('ray-abc')
    expect(event.requestId).toBe('ray-abc')
  })

  it('skips excluded routes and still runs the handler', async () => {
    const { drain } = createPipelineSpies()
    let ran = false
    const worker = withEvlog(() => {
      ran = true
      return new Response('ok')
    }, { drain, exclude: ['/health'] })

    const res = await fireWorker(worker, { path: '/health' })

    expect(ran).toBe(true)
    expect(res.status).toBe(200)
    expect(findEventViaDrain(drain, e => e.path === '/health')).toBeUndefined()
  })

  it('runs enrich before drain', async () => {
    const { drain, enrich } = createPipelineSpies()
    enrich.mockImplementation((ctx) => {
      ctx.event.region = 'cdg'
    })
    const worker = withEvlog(() => new Response('ok'), { drain, enrich })

    await fireWorker(worker, { path: '/api/x' })
    await waitForDrainCalls(drain)

    expect(drain.mock.calls[0][0].event.region).toBe('cdg')
  })

  it('registers drain work with ctx.waitUntil', async () => {
    const { drain } = createPipelineSpies()
    const scheduled: Promise<unknown>[] = []
    const worker = withEvlog(() => new Response('ok'), { drain })

    await fireWorker(worker, { path: '/api/x' }, { waitUntil: p => scheduled.push(p) })

    expect(scheduled.length).toBeGreaterThan(0)
    await Promise.all(scheduled)
    await waitForDrainCalls(drain)
    assertHttpEventEmitted(drain, { path: '/api/x', status: 200 })
  })

  it('records the error and rethrows when the handler throws', async () => {
    const { drain } = createPipelineSpies()
    const worker = withEvlog(() => {
      throw new Error('boom')
    }, { drain })

    await expect(fireWorker(worker, { path: '/api/fail' })).rejects.toThrow('boom')
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/fail', level: 'error', status: 500 })
  })

  it('records an EvlogError with no status as a 500 and rethrows it', async () => {
    const { drain } = createPipelineSpies()
    const worker = withEvlog(() => {
      throw new EvlogError({ message: 'Turn could not start' })
    }, { drain })

    await expect(fireWorker(worker, { path: '/api/fail' })).rejects.toThrow('Turn could not start')
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/fail', level: 'error', status: 500 })
  })

  it('defers the emit until a streaming body completes', async () => {
    const { drain } = createPipelineSpies()
    const { stream, close } = createDeferredStream()

    const worker = withEvlog((_req, _env, _ctx, log) => {
      queueMicrotask(() => log.set({ ai: { calls: 1 } }))
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    }, { drain })

    const res = await fireWorker(worker, { path: '/api/chat' })
    expect(drain).not.toHaveBeenCalled()

    close()
    await expect(res.text()).resolves.toBe('hello world')
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))

    expect(drain.mock.calls[0][0].event.ai).toEqual({ calls: 1 })
  })
})
