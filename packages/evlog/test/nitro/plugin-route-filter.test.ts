import { describe, expect, it, vi } from 'vitest'
import type { RequestLogger, WideEvent } from '../../src/types'

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return { ...actual, getHeaders: vi.fn(() => ({})) }
})

vi.mock('../../src/shared/nitroConfigBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/nitroConfigBridge')>()
  return {
    ...actual,
    setActiveNitroRuntime: vi.fn(),
    resolveEvlogConfigForNitroPlugin: vi.fn(() => Promise.resolve({ silent: true, exclude: ['/internal/**'] })),
  }
})

import plugin from '../../src/nitro/plugin'

type Handler = (...args: any[]) => unknown

async function boot() {
  const handlers: Record<string, Handler[]> = {}
  const drained: WideEvent[] = []
  await (plugin as unknown as (app: unknown) => Promise<void>)({
    hooks: {
      hook: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn),
      callHook: (name: string, ctx: { event: WideEvent }) => {
        if (name === 'evlog:drain') drained.push(ctx.event)
        return Promise.resolve()
      },
    },
  })
  async function request(path: string, handle: (log: RequestLogger) => void, error?: Error) {
    const event = { method: 'POST', path, context: {} as Record<string, unknown>, response: { status: error ? 500 : 200 } }
    for (const fn of handlers.request ?? []) await fn(event)
    handle(event.context.log as RequestLogger)
    if (error) {
      for (const fn of handlers.error ?? []) await fn(error, { event })
    }
    for (const fn of handlers.afterResponse ?? []) await fn(event)
  }
  return { request, drained }
}

const audit = { action: 'token.create', actor: { type: 'api' as const, id: 'tok_12' }, target: { type: 'token', id: 'tok_99' } }

describe('nitro plugin route filters', () => {
  it('emits the request event of an excluded route that recorded an audit', async () => {
    const { request, drained } = await boot()
    await request('/internal/tokens', log => log.audit(audit))

    expect(drained).toHaveLength(1)
    expect(drained[0]).toMatchObject({ path: '/internal/tokens', status: 200, audit: { action: 'token.create', outcome: 'success' } })
  })

  it('emits once when an excluded route that recorded an audit fails', async () => {
    const { request, drained } = await boot()
    await request('/internal/tokens', log => log.audit(audit), new Error('boom'))

    await vi.waitFor(() => expect(drained).toHaveLength(1))
    expect(drained[0]).toMatchObject({ path: '/internal/tokens', level: 'error', audit: { action: 'token.create' } })
  })

  it('emits nothing for an excluded route without an audit', async () => {
    const { request, drained } = await boot()
    await request('/internal/health', log => log.set({ probe: true }))
    await request('/internal/health', () => {}, new Error('boom'))

    expect(drained).toHaveLength(0)
  })
})
