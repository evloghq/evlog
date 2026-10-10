import { describe, expect, it, vi } from 'vitest'
import { defineEvlog, mergeEvlogConfig, toLoggerConfig } from '../../src/shared/define'

describe('defineEvlog extends', () => {
  it('returns the config untouched when it extends nothing', () => {
    const config = { service: 'shop' }
    expect(defineEvlog(config)).toBe(config)
  })

  it('lets the child win on scalars and drops the extends key', () => {
    const preset = defineEvlog({ service: 'preset', minLevel: 'info', pretty: false })
    const config = defineEvlog({ extends: preset, service: 'checkout' })
    expect(config).toEqual({ service: 'checkout', minLevel: 'info', pretty: false })
    expect('extends' in config).toBe(false)
  })

  it('merges plain objects key by key', () => {
    const preset = defineEvlog({
      sampling: { rates: { info: 10, debug: 0 } },
      routes: { '/api/auth/**': { service: 'auth' } },
      map: { rules: { 'audit': 'off', 'error-catalog': 'off' }, minScore: 70 },
    })
    const config = defineEvlog({
      extends: preset,
      sampling: { rates: { info: 50 } },
      routes: { '/api/billing/**': { service: 'billing' } },
      map: { rules: { audit: 'on' } },
    })
    expect(config.sampling).toEqual({ rates: { info: 50, debug: 0 } })
    expect(config.routes).toEqual({
      '/api/auth/**': { service: 'auth' },
      '/api/billing/**': { service: 'billing' },
    })
    expect(config.map).toEqual({ rules: { 'audit': 'on', 'error-catalog': 'off' }, minScore: 70 })
  })

  it('replaces arrays, except the redact and keep lists, which grow', () => {
    const preset = defineEvlog({
      include: ['/api/**'],
      map: { ignore: ['scripts/**'] },
      redact: { paths: ['user.ssn'], patterns: [/acct-\d+/g] },
      sampling: { keep: [{ status: 500 }] },
    })
    const config = defineEvlog({
      extends: preset,
      include: ['/rpc/**'],
      map: { ignore: ['fixtures/**'] },
      redact: { paths: ['card.number'] },
      sampling: { keep: [{ duration: 1000 }] },
    })
    expect(config.include).toEqual(['/rpc/**'])
    expect(config.map?.ignore).toEqual(['fixtures/**'])
    expect(config.redact).toEqual({ paths: ['user.ssn', 'card.number'], patterns: [/acct-\d+/g] })
    expect(config.sampling?.keep).toEqual([{ status: 500 }, { duration: 1000 }])
  })

  it('keeps the parent redact object under redact: true, and turns it off under redact: false', () => {
    const preset = defineEvlog({ redact: { paths: ['user.ssn'] } })
    expect(defineEvlog({ extends: preset, redact: true }).redact).toEqual({ paths: ['user.ssn'] })
    expect(defineEvlog({ extends: preset, redact: false }).redact).toBe(false)
  })

  it('merges plugins by name and replaces functions', () => {
    const parentDrain = vi.fn()
    const childDrain = vi.fn()
    const preset = defineEvlog({
      drain: parentDrain,
      plugins: [{ name: 'axiom', setup: vi.fn() }, { name: 'geo' }],
    })
    const override = { name: 'axiom' }
    const config = defineEvlog({ extends: preset, drain: childDrain, plugins: [override, { name: 'audit' }] })
    expect(config.drain).toBe(childDrain)
    expect(config.plugins?.map(plugin => plugin.name)).toEqual(['axiom', 'geo', 'audit'])
    expect(config.plugins?.[0]).toBe(override)
  })

  it('carries parent values through toLoggerConfig', () => {
    const drain = vi.fn()
    const logger = toLoggerConfig(defineEvlog({ extends: defineEvlog({ drain, environment: 'production' }), service: 'shop' }))
    expect(logger.drain).toBe(drain)
    expect(logger.env).toEqual({ service: 'shop', environment: 'production' })
  })

  it('refuses a parent that already extends another config', () => {
    const base = defineEvlog({ service: 'base' })
    const preset = defineEvlog({ extends: base, minLevel: 'warn' })
    expect(() => defineEvlog({ extends: preset })).toThrow('one level only')
    expect(() => mergeEvlogConfig({ extends: base }, { service: 'app' })).toThrow('one level only')
  })

  it('does not mutate the parent', () => {
    const preset = defineEvlog({ sampling: { rates: { info: 10 } }, redact: { paths: ['a'] } })
    defineEvlog({ extends: preset, sampling: { rates: { info: 90 } }, redact: { paths: ['b'] } })
    expect(preset).toEqual({ sampling: { rates: { info: 10 } }, redact: { paths: ['a'] } })
  })
})
