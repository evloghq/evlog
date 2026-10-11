import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvlogConfig } from '../../src/shared/define'
import { EVLOG_FILE_CONFIG_KEY } from '../../src/shared/fileConfig'

interface RuntimeConfig {
  public: { evlog?: Record<string, unknown> }
}

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: (event: { config: RuntimeConfig }) => event.config,
}))

const { default: publicConfigPlugin } = await import('../../src/runtime/server/public-config') as unknown as {
  default: (nitroApp: { hooks: { hook: (name: string, handler: (event: unknown) => void) => void } }) => void
}

function loadFile(config: EvlogConfig | undefined): void {
  (globalThis as Record<symbol, unknown>)[Symbol.for(EVLOG_FILE_CONFIG_KEY)] = config
}

/** The runtime config Nitro serves for these `nuxt.config.ts` options, where a key left unset reads as `''`. */
function runtimeConfigFor(options: EvlogConfig): RuntimeConfig {
  return {
    public: { evlog: { enabled: options.enabled ?? '', pretty: options.pretty ?? '', minLevel: options.minLevel ?? '' } },
  }
}

/** Starts the plugin and returns its `request` hook, if it registered one. */
function requestHook(): ((event: { config: RuntimeConfig }) => void) | undefined {
  const hook = vi.fn()
  publicConfigPlugin({ hooks: { hook } })
  return hook.mock.calls.find(([name]) => name === 'request')?.[1]
}

describe('nuxt browser settings from evlog.config.ts', () => {
  afterEach(() => {
    loadFile(undefined)
  })

  it('copies the browser settings of the file into the public runtime config', () => {
    loadFile({ enabled: false, pretty: false, minLevel: 'warn' })
    const config = runtimeConfigFor({})

    requestHook()?.({ config })

    expect(config.public.evlog).toEqual({ enabled: false, pretty: false, minLevel: 'warn' })
  })

  it('keeps what nuxt.config.ts sets', () => {
    loadFile({ enabled: false, minLevel: 'warn' })
    const config = runtimeConfigFor({ enabled: true, minLevel: 'error' })

    requestHook()?.({ config })

    expect(config.public.evlog).toEqual({ enabled: true, pretty: '', minLevel: 'error' })
  })

  it('keeps what a NUXT_PUBLIC_EVLOG variable sets', () => {
    loadFile({ enabled: false, minLevel: 'warn' })
    const config = runtimeConfigFor({})
    config.public.evlog = { enabled: true, pretty: '', minLevel: 'debug' }

    requestHook()?.({ config })

    expect(config.public.evlog).toEqual({ enabled: true, pretty: '', minLevel: 'debug' })
  })

  it('registers nothing when the file sets no browser setting', () => {
    loadFile({ service: 'shop' })

    expect(requestHook()).toBeUndefined()
  })

  it('registers nothing when the app has no config file', () => {
    expect(requestHook()).toBeUndefined()
  })
})
