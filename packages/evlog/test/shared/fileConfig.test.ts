import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvlogConfig } from '../../src/shared/define'
import {
  EVLOG_FILE_CONFIG_KEY,
  EVLOG_FILE_CONFIG_PLUGIN,
  evlogFileConfigPlugins,
  flushEvlogFileConfigDrain,
  readEvlogFileConfig,
  withEvlogFileConfig,
} from '../../src/shared/fileConfig'
import { definePlugin } from '../../src/shared/plugin'
import { createDrainPipeline } from '../../src/pipeline'
import type { DrainContext } from '../../src/types'

const slot = Symbol.for(EVLOG_FILE_CONFIG_KEY)

function loadFile(config: EvlogConfig): void {
  (globalThis as Record<symbol, unknown>)[slot] = config
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[slot]
})

describe('withEvlogFileConfig', () => {
  it('returns the module options as they are without a file', () => {
    const options = { env: { service: 'api' } }
    expect(readEvlogFileConfig()).toBeUndefined()
    expect(withEvlogFileConfig(options)).toBe(options)
    expect(withEvlogFileConfig(undefined)).toBeUndefined()
  })

  it('maps service and environment of the file into env', () => {
    loadFile({ service: 'checkout', environment: 'staging', sampling: { rates: { info: 10 } } })
    expect(withEvlogFileConfig(undefined)).toEqual({
      env: { service: 'checkout', environment: 'staging' },
      sampling: { rates: { info: 10 } },
    })
  })

  it('lays the module options over the file', () => {
    loadFile({
      service: 'checkout',
      environment: 'staging',
      silent: true,
      sampling: { rates: { info: 10, warn: 50 } },
      redact: { paths: ['user.email'] },
    })
    expect(withEvlogFileConfig({
      env: { environment: 'production' },
      sampling: { rates: { info: 100 } },
      redact: { paths: ['card.number'] },
    })).toEqual({
      env: { service: 'checkout', environment: 'production' },
      silent: true,
      sampling: { rates: { info: 100, warn: 50 } },
      redact: { paths: ['user.email', 'card.number'] },
    })
  })

  it('leaves out the CLI sections and the functions', () => {
    loadFile({
      service: 'checkout',
      map: { minScore: 80 },
      logs: { dir: '.evlog/logs' },
      drain: vi.fn(),
      enrich: vi.fn(),
      keep: vi.fn(),
      plugins: [definePlugin({ name: 'audit' })],
      waitUntil: vi.fn(),
    })
    expect(withEvlogFileConfig(undefined)).toEqual({ env: { service: 'checkout' } })
  })
})

describe('evlogFileConfigPlugins', () => {
  it('is undefined without a file', () => {
    expect(evlogFileConfigPlugins()).toBeUndefined()
  })

  it('is empty when the file has no plugin, drain, enrich or keep', () => {
    loadFile({ service: 'checkout' })
    expect(evlogFileConfigPlugins()).toEqual([])
  })

  it('carries drain, enrich and keep in one plugin after the plugins of the file', () => {
    const drain = vi.fn()
    const enrich = vi.fn()
    const keep = vi.fn()
    const audit = definePlugin({ name: 'audit' })
    loadFile({ drain, enrich, keep, plugins: [audit] })

    expect(evlogFileConfigPlugins()).toEqual([
      audit,
      { name: EVLOG_FILE_CONFIG_PLUGIN, drain, enrich, keep },
    ])
  })
})

describe('flushEvlogFileConfigDrain', () => {
  it('delivers the events a pipeline drain of the file still buffers', async () => {
    const send = vi.fn()
    const drain = createDrainPipeline<DrainContext>({ batch: { size: 50, intervalMs: 60_000 } })(send)
    loadFile({ drain })

    drain({ event: { timestamp: '', level: 'info', service: 'checkout', environment: 'test' } })
    expect(send).not.toHaveBeenCalled()

    await flushEvlogFileConfigDrain()
    expect(send).toHaveBeenCalledOnce()
    expect(drain.pending).toBe(0)
  })

  it('resolves without a file or with a drain that does not buffer', async () => {
    await expect(flushEvlogFileConfigDrain()).resolves.toBeUndefined()
    loadFile({ drain: vi.fn() })
    await expect(flushEvlogFileConfigDrain()).resolves.toBeUndefined()
  })
})
