import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NitroPluginEvlogConfig } from '../../src/nitro'

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return { ...actual, getHeaders: vi.fn(() => ({})) }
})

const state = vi.hoisted(() => ({ config: {} as Record<string, unknown> }))

vi.mock('../../src/shared/nitroConfigBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/nitroConfigBridge')>()
  return {
    ...actual,
    setActiveNitroRuntime: vi.fn(),
    resolveEvlogConfigForNitroPlugin: vi.fn(() => Promise.resolve(state.config as NitroPluginEvlogConfig)),
  }
})

import plugin from '../../src/nitro/plugin'

type Handler = (...args: any[]) => unknown

interface FakeNitro {
  handlers: Record<string, Handler[]>
  hooks: { hook: (name: string, fn: Handler) => void, callHook: (name: string, ...args: unknown[]) => Promise<void> }
  drainCalls: () => number
}

function createFakeNitro(): FakeNitro {
  const handlers: Record<string, Handler[]> = {}
  const calls: string[] = []
  return {
    handlers,
    drainCalls: () => calls.filter(name => name === 'evlog:drain').length,
    hooks: {
      hook(name, fn) {
        const list = (handlers[name] ??= [])
        list.push(fn)
      },
      callHook(name) {
        calls.push(name)
        return Promise.resolve()
      },
    },
  }
}

async function boot(config: Record<string, unknown>): Promise<FakeNitro> {
  state.config = { silent: true, sampling: { rates: { info: 100 } }, ...config }
  const nitro = createFakeNitro()
  await (plugin as unknown as (app: unknown) => Promise<void>)(nitro)
  return nitro
}

async function runRequest(nitro: FakeNitro, opts: { method: string, path: string, status: number, error?: Error & { statusCode?: number } }) {
  const event = { method: opts.method, path: opts.path, context: {} as Record<string, unknown>, response: { status: opts.status } }
  for (const fn of nitro.handlers.request ?? []) fn(event)
  if (opts.error) {
    for (const fn of nitro.handlers.error ?? []) await fn(opts.error, { event })
  }
  for (const fn of nitro.handlers.afterResponse ?? []) await fn(event)
}

const TRANSPORT = { transport: { enabled: true } }

describe('client transport request logging', () => {
  beforeEach(() => {
    state.config = {}
  })

  it('does not emit a request wide event for a successful transport POST', async () => {
    const nitro = await boot(TRANSPORT)
    await runRequest(nitro, { method: 'POST', path: '/api/_evlog/ingest', status: 204 })
    expect(nitro.drainCalls()).toBe(0)
  })

  it('ignores the query string when matching the transport endpoint', async () => {
    const nitro = await boot(TRANSPORT)
    await runRequest(nitro, { method: 'POST', path: '/api/_evlog/ingest?batch=1', status: 204 })
    expect(nitro.drainCalls()).toBe(0)
  })

  it('still emits a request wide event when the transport POST fails with 4xx', async () => {
    const nitro = await boot(TRANSPORT)
    await runRequest(nitro, { method: 'POST', path: '/api/_evlog/ingest', status: 403 })
    expect(nitro.drainCalls()).toBe(1)
  })

  it('emits once for a transport POST that throws through the error hook', async () => {
    const nitro = await boot(TRANSPORT)
    const error = Object.assign(new Error('Invalid origin'), { statusCode: 403 })
    await runRequest(nitro, { method: 'POST', path: '/api/_evlog/ingest', status: 403, error })
    expect(nitro.drainCalls()).toBe(1)
  })

  it('keeps emitting successful requests on other routes', async () => {
    const nitro = await boot(TRANSPORT)
    await runRequest(nitro, { method: 'POST', path: '/api/orders', status: 204 })
    expect(nitro.drainCalls()).toBe(1)
  })

  it('does not special-case the endpoint when transport is disabled', async () => {
    const nitro = await boot({ transport: { enabled: false } })
    await runRequest(nitro, { method: 'POST', path: '/api/_evlog/ingest', status: 204 })
    expect(nitro.drainCalls()).toBe(1)
  })

  it('honours a custom transport endpoint', async () => {
    const nitro = await boot({ transport: { enabled: true, endpoint: '/api/logs' } })
    await runRequest(nitro, { method: 'POST', path: '/api/logs', status: 204 })
    expect(nitro.drainCalls()).toBe(0)
  })

  it('respects an explicit exclude over the transport rule', async () => {
    const nitro = await boot({ ...TRANSPORT, exclude: ['/api/_evlog/**'] })
    await runRequest(nitro, { method: 'POST', path: '/api/_evlog/ingest', status: 500 })
    expect(nitro.drainCalls()).toBe(0)
  })
})
