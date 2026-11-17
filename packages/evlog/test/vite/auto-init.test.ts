import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConfigEnv, Plugin, UserConfig } from 'vite'
import { describe, expect, it } from 'vitest'
import { createAutoInitPlugin } from '../../src/vite/auto-init'
import type { EvlogViteOptions } from '../../src/vite/types'

const configEnv: ConfigEnv = { command: 'build', mode: 'test' }

type ConfigHook = (config: UserConfig, env: ConfigEnv) => Promise<UserConfig>

function runConfigHook(plugin: Plugin, root: string): Promise<UserConfig> {
  return (plugin.config as ConfigHook)({ root }, configEnv)
}

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'evlog-vite-auto-init-'))
}

function getDefineConfig(plugin: any): Record<string, string> {
  return plugin.config({ root: makeRoot() }).define
}

/** Write `evlog.config.ts` in a fresh root and resolve the plugin's `define` for it. */
async function defineWithFile(content: string, options: EvlogViteOptions = {}): Promise<{ define: Record<string, string>, file: string }> {
  const root = makeRoot()
  const file = join(root, 'evlog.config.ts')
  writeFileSync(file, content)
  const plugin = createAutoInitPlugin(options as EvlogViteOptions)
  const result = await runConfigHook(plugin, root)
  return { define: result.define as Record<string, string>, file }
}

describe('vite auto-init plugin', () => {
  it('includes service in config', () => {
    const plugin = createAutoInitPlugin({ service: 'my-app' })
    const define = getDefineConfig(plugin)
    const config = JSON.parse(define.__EVLOG_CONFIG__)
    expect(config.env.service).toBe('my-app')
  })

  it('includes sampling config', () => {
    const plugin = createAutoInitPlugin({
      service: 'my-app',
      sampling: {
        rates: { info: 10, debug: 0 },
        keep: [{ status: 400 }],
      },
    })
    const define = getDefineConfig(plugin)
    const config = JSON.parse(define.__EVLOG_CONFIG__)
    expect(config.sampling.rates.info).toBe(10)
    expect(config.sampling.rates.debug).toBe(0)
    expect(config.sampling.keep).toEqual([{ status: 400 }])
  })

  it('includes environment', () => {
    const plugin = createAutoInitPlugin({
      service: 'my-app',
      environment: 'staging',
    })
    const define = getDefineConfig(plugin)
    const config = JSON.parse(define.__EVLOG_CONFIG__)
    expect(config.env.environment).toBe('staging')
  })

  it('includes minLevel', () => {
    const plugin = createAutoInitPlugin({
      service: 'my-app',
      minLevel: 'warn',
    })
    const define = getDefineConfig(plugin)
    const config = JSON.parse(define.__EVLOG_CONFIG__)
    expect(config.minLevel).toBe('warn')
  })

  it('includes all serializable options', () => {
    const plugin = createAutoInitPlugin({
      service: 'api',
      enabled: true,
      pretty: false,
      silent: true,
      stringify: false,
    })
    const define = getDefineConfig(plugin)
    const config = JSON.parse(define.__EVLOG_CONFIG__)
    expect(config.enabled).toBe(true)
    expect(config.pretty).toBe(false)
    expect(config.silent).toBe(true)
    expect(config.stringify).toBe(false)
  })

  it('produces empty object when no config is provided', () => {
    const plugin = createAutoInitPlugin({})
    const define = getDefineConfig(plugin)
    const config = JSON.parse(define.__EVLOG_CONFIG__)
    expect(config).toEqual({})
  })

  it('omits undefined fields', () => {
    const plugin = createAutoInitPlugin({ service: 'app' })
    const define = getDefineConfig(plugin)
    const config = JSON.parse(define.__EVLOG_CONFIG__)
    expect(config).not.toHaveProperty('pretty')
    expect(config).not.toHaveProperty('silent')
    expect(config).not.toHaveProperty('sampling')
  })
})

describe('vite auto-init plugin with evlog.config.ts', () => {
  it('reads the file when no plugin option is set', async () => {
    const { define } = await defineWithFile(`export default {
  service: 'from-file',
  environment: 'staging',
  pretty: false,
  sampling: { rates: { info: 10 } },
  drain: () => {},
}\n`)
    const config = JSON.parse(define.__EVLOG_CONFIG__)
    expect(config).toEqual({
      env: { service: 'from-file', environment: 'staging' },
      pretty: false,
      sampling: { rates: { info: 10 } },
    })
  })

  it('reads service and environment from the env block, as toLoggerConfig does', async () => {
    const { define } = await defineWithFile(`export default {
  env: { service: 'from-env-block', environment: 'staging' },
}\n`)
    expect(JSON.parse(define.__EVLOG_CONFIG__)).toEqual({
      env: { service: 'from-env-block', environment: 'staging' },
    })
  })

  it('prefers a top-level service over env.service in the file, as toLoggerConfig does', async () => {
    const { define } = await defineWithFile(`export default {
  service: 'top-level',
  env: { service: 'from-env-block' },
}\n`)
    expect(JSON.parse(define.__EVLOG_CONFIG__).env.service).toBe('top-level')
  })

  it('lets plugin options override the same key and keeps the other file keys', async () => {
    const { define } = await defineWithFile(`export default {
  service: 'from-file',
  pretty: false,
  silent: true,
  sampling: { rates: { info: 10 }, keep: [{ status: 500 }] },
}\n`, {
      service: 'from-options',
      sampling: { rates: { debug: 0 }, keep: [{ status: 400 }] },
    })
    const config = JSON.parse(define.__EVLOG_CONFIG__)
    expect(config.env.service).toBe('from-options')
    expect(config.pretty).toBe(false)
    expect(config.silent).toBe(true)
    expect(config.sampling.rates).toEqual({ info: 10, debug: 0 })
    expect(config.sampling.keep).toEqual([{ status: 500 }, { status: 400 }])
  })

  it('keeps the plugin output unchanged when there is no file', () => {
    const plugin = createAutoInitPlugin({ service: 'app', pretty: false })
    const { define } = plugin.config({ root: makeRoot() })
    expect(define.__EVLOG_CONFIG__).toBe('{"env":{"service":"app"},"pretty":false}')
  })

  it('fails the build with the file path when the file does not load', async () => {
    const root = makeRoot()
    const file = join(root, 'evlog.config.ts')
    writeFileSync(file, 'export default {\n')
    const plugin = createAutoInitPlugin({})
    await expect(runConfigHook(plugin, root)).rejects.toThrow(file)
  })
})
