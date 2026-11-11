import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NitroPluginEvlogConfig } from '../../src/nitro'

vi.mock('../../src/shared/nitroConfigBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/nitroConfigBridge')>()
  return {
    ...actual,
    setActiveNitroRuntime: vi.fn(),
    resolveEvlogConfigForNitroPlugin: vi.fn(() => Promise.resolve({ silent: true } as NitroPluginEvlogConfig)),
  }
})

import { createLogger, initLogger } from '../../src/logger'
import pluginV2 from '../../src/nitro/plugin'
import pluginV3 from '../../src/nitro-v3/plugin'
import { flushMicrotasks } from '../helpers/timers'

type NitroPlugin = (app: unknown) => unknown

function createFakeNitro() {
  return { hooks: { hook: vi.fn(), callHook: vi.fn(() => Promise.resolve()) } }
}

describe.each([
  ['nitro (v2)', pluginV2],
  ['nitro (v3)', pluginV3],
])('%s plugin and a drain from another plugin', (_name, evlogPlugin) => {
  afterEach(() => {
    initLogger()
  })

  it('keeps a drain another plugin registered synchronously during the plugin loop', async () => {
    const drain = vi.fn()
    const app = createFakeNitro()
    const userPlugin: NitroPlugin = () => {
      initLogger({ drain })
    }

    // Nitro calls each plugin in order without awaiting it.
    const pending = [evlogPlugin as unknown as NitroPlugin, userPlugin].map(plugin => plugin(app))
    await Promise.all(pending)

    createLogger({ task: 'cleanup' }).emit()
    await flushMicrotasks()

    expect(drain).toHaveBeenCalledTimes(1)
    expect(drain.mock.calls[0]?.[0].event).toMatchObject({ task: 'cleanup' })
  })
})
