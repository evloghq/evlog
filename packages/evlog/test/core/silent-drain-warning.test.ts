import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initLogger } from '../../src/logger'
import { configureHandler } from '../../src/next/handler'
import nitroPlugin from '../../src/nitro/plugin'
import nitroV3Plugin from '../../src/nitro-v3/plugin'

vi.mock('next/server', () => ({
  after: undefined,
}))

const SILENT_WARNING = 'silent mode is enabled but no drain is configured'

function silentWarnings(warn: ReturnType<typeof vi.spyOn>): unknown[][] {
  return warn.mock.calls.filter(([message]) => String(message).includes(SILENT_WARNING))
}

// Each integration initializes the logger before its drain is wired: next
// attaches the drain per request in middleware, nitro and nitro-v3 attach it
// on the `evlog:drain` hook. A silent app is therefore not a silent app with
// no drain, and the warning must not fire for it.
describe('silent-without-drain warning', () => {
  let warn: ReturnType<typeof vi.spyOn>
  let previousConfig: string | undefined

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    previousConfig = process.env.__EVLOG_CONFIG
    // The nitro plugins read their config from this variable when no bundle
    // inlines it, so a silent app is declared here.
    process.env.__EVLOG_CONFIG = JSON.stringify({ silent: true, pretty: false })
  })

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.__EVLOG_CONFIG
    else process.env.__EVLOG_CONFIG = previousConfig
    vi.restoreAllMocks()
  })

  it('logger: warns when the app is silent and no drain is configured', () => {
    initLogger({ silent: true, pretty: false })

    expect(silentWarnings(warn)).toHaveLength(1)
  })

  it('logger: does not warn when a drain is configured', () => {
    initLogger({ silent: true, pretty: false, drain: () => {} })

    expect(silentWarnings(warn)).toHaveLength(0)
  })

  it('next: a silent app does not warn, its drain runs per request', () => {
    configureHandler({ silent: true, pretty: false })

    expect(silentWarnings(warn)).toHaveLength(0)
  })

  it('nitro: a silent app does not warn, its drain is attached on evlog:drain', async () => {
    const hook = vi.fn()
    await nitroPlugin({ hooks: { hook, callHook: vi.fn() } } as never)
    expect(hook).toHaveBeenCalled()

    expect(silentWarnings(warn)).toHaveLength(0)
  })

  it('nitro v3: a silent app does not warn, its drain is attached on evlog:drain', async () => {
    const hook = vi.fn()
    await nitroV3Plugin({ hooks: { hook, callHook: vi.fn() } } as never)
    expect(hook).toHaveBeenCalled()

    expect(silentWarnings(warn)).toHaveLength(0)
  })
})
