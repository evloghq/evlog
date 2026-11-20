import { describe, expect, it, vi } from 'vitest'
import { createDrainPipeline } from '../../src/pipeline'

vi.mock('../../src/shared/nitroConfigBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/nitroConfigBridge')>()
  return { ...actual, setActiveNitroRuntime: vi.fn(), resolveEvlogConfigForNitroPlugin: vi.fn(() => Promise.resolve({ silent: true })) }
})

import plugin from '../../src/nitro/plugin'

describe('nitro plugin close hook', () => {
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
