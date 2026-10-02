import { describe, expect, it } from 'vitest'
import { createAutoInitPlugin } from '../../src/vite/auto-init'

function getDefineConfig(plugin: any): Record<string, string> {
  return plugin.config().define
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
