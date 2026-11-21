import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createDrainPipeline } from '../../src/pipeline'

vi.mock('nitro', () => ({ definePlugin: <T>(plugin: T) => plugin }))

vi.mock('../../src/shared/nitroConfigBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/nitroConfigBridge')>()
  return { ...actual, setActiveNitroRuntime: vi.fn(), resolveEvlogConfigForNitroPlugin: vi.fn(() => Promise.resolve({ silent: true })) }
})

import plugin from '../../src/nitro-v3/plugin'

describe('nitro v3 plugin close hook', () => {
  it('delivers events a drain pipeline holds before close resolves', async () => {
    const handlers: Record<string, Array<() => unknown>> = {}
    await (plugin as unknown as (app: unknown) => Promise<void>)({
      hooks: { hook: (name: string, fn: () => unknown) => (handlers[name] ??= []).push(fn), callHook: () => Promise.resolve() },
    })
    let delivered = 0
    const drain = createDrainPipeline<{ id: number }>({ batch: { size: 100, intervalMs: 600_000 } })(async (batch) => {
      await new Promise(resolve => setTimeout(resolve, 20))
      delivered += batch.length
    })
    drain({ id: 1 })

    await Promise.all((handlers.close ?? []).map(fn => fn()))

    expect(delivered).toBe(1)
  })
})

describe('nitro v3 plugin drain hook', () => {
  it('registers the request-end flush when a synchronous evlog:drain hook buffered the event', async () => {
    vi.stubEnv('VERCEL', '1')
    onTestFinished(() => {
      vi.unstubAllEnvs()
    })
    const handlers: Record<string, Array<(...args: any[]) => unknown>> = {}
    const send = vi.fn().mockResolvedValue(undefined)
    const drain = createDrainPipeline({ batch: { size: 100, intervalMs: 600_000 } })(send)
    await (plugin as unknown as (app: unknown) => Promise<void>)({
      hooks: {
        hook: (name: string, fn: (...args: any[]) => unknown) => (handlers[name] ??= []).push(fn),
        // hookable 6 returns undefined when every listener is synchronous.
        callHook: (name: string, ctx: unknown) => {
          if (name === 'evlog:drain') drain(ctx)
          return undefined
        },
      },
    })
    const waitUntil = vi.fn()
    const event = { req: { url: 'http://localhost/api/orders', method: 'GET', headers: new Headers(), context: {}, waitUntil } }

    for (const fn of handlers.request ?? []) await fn(event)
    for (const fn of handlers.response ?? []) await fn(new Response('ok'), event)

    expect(waitUntil).toHaveBeenCalledOnce()
    await waitUntil.mock.calls[0]?.[0]
    expect(send).toHaveBeenCalledOnce()
  })
})
