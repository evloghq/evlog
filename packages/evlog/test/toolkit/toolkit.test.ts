import { AsyncLocalStorage } from 'node:async_hooks'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initLogger } from '../../src/logger'
import {
  composeDrains,
  composeEnrichers,
  composeKeep,
  composePlugins,
  createPluginRunner,
  defineEnricher,
  defineEvlog,
  defineFrameworkIntegration,
  defineHttpDrain,
  definePlugin,
  drainPlugin,
  enricherPlugin,
  getEmptyPluginRunner,
  getHeader,
  mergeEventField,
  normalizeNumber,
  toLoggerConfig,
  toMiddlewareOptions,
  toOtlpAttributeValue,
  toTypedAttributeValue,
} from '../../src/shared/index'
import type { DrainContext, EnrichContext, RequestLogger, TailSamplingContext, WideEvent } from '../../src/types'

const baseEvent = (): WideEvent => ({
  timestamp: '2030-01-01T00:00:00.000Z',
  level: 'info',
  service: 'test',
  environment: 'test',
})

const enrichCtx = (event: WideEvent = baseEvent(), overrides: Partial<EnrichContext> = {}): EnrichContext => ({
  event,
  ...overrides,
})

const drainCtx = (event: WideEvent = baseEvent()): DrainContext => ({ event })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('headers helpers', () => {
  it('getHeader is case-insensitive', () => {
    expect(getHeader({ 'X-Tenant-Id': 'acme' }, 'x-tenant-id')).toBe('acme')
    expect(getHeader({ 'x-tenant-id': 'acme' }, 'X-Tenant-Id')).toBe('acme')
    expect(getHeader({}, 'x-foo')).toBeUndefined()
    expect(getHeader(undefined, 'x-foo')).toBeUndefined()
  })

  it('normalizeNumber handles invalid input', () => {
    expect(normalizeNumber('42')).toBe(42)
    expect(normalizeNumber('NaN')).toBeUndefined()
    expect(normalizeNumber(undefined)).toBeUndefined()
    expect(normalizeNumber('')).toBeUndefined()
  })
})

describe('event helpers', () => {
  it('mergeEventField preserves user values by default', () => {
    const merged = mergeEventField({ id: 'user' }, { id: 'computed', extra: 1 })
    expect(merged).toEqual({ id: 'user', extra: 1 })
  })

  it('mergeEventField overwrites when requested', () => {
    const merged = mergeEventField({ id: 'user' }, { id: 'computed' }, true)
    expect(merged).toEqual({ id: 'computed' })
  })

  it('mergeEventField writes primitive value when no existing value', () => {
    expect(mergeEventField(undefined, 'fast')).toBe('fast')
    expect(mergeEventField(null, 42)).toBe(42)
  })

  it('mergeEventField preserves primitive value over computed primitive', () => {
    expect(mergeEventField('user', 'computed')).toBe('user')
    expect(mergeEventField(50, 37)).toBe(50)
  })

  it('mergeEventField overwrites primitive value when requested', () => {
    expect(mergeEventField('user', 'computed', true)).toBe('computed')
  })

  it('mergeEventField preserves user values when computed is primitive', () => {
    expect(mergeEventField({ foo: 'bar' }, 'fast')).toEqual({ foo: 'bar' })
  })

  it('toTypedAttributeValue distinguishes integers and doubles', () => {
    expect(toTypedAttributeValue(42)).toEqual({ value: 42, type: 'integer' })
    expect(toTypedAttributeValue(3.14)).toEqual({ value: 3.14, type: 'double' })
    expect(toTypedAttributeValue(true)).toEqual({ value: true, type: 'boolean' })
    expect(toTypedAttributeValue('hi')).toEqual({ value: 'hi', type: 'string' })
    expect(toTypedAttributeValue({ x: 1 })).toEqual({ value: '{"x":1}', type: 'string' })
    expect(toTypedAttributeValue(null)).toBeUndefined()
  })

  it('toOtlpAttributeValue maps to OTLP AnyValue', () => {
    expect(toOtlpAttributeValue(42)).toEqual({ intValue: '42' })
    expect(toOtlpAttributeValue(true)).toEqual({ boolValue: true })
    expect(toOtlpAttributeValue('hi')).toEqual({ stringValue: 'hi' })
    expect(toOtlpAttributeValue({ x: 1 })).toEqual({ stringValue: '{"x":1}' })
  })
})

describe('defineEnricher', () => {
  it('skips when compute returns undefined', () => {
    const enricher = defineEnricher<{ id: string }>({
      name: 'tenant',
      field: 'tenant',
      compute: () => undefined,
    })
    const ctx = enrichCtx()
    enricher(ctx)
    expect(ctx.event.tenant).toBeUndefined()
  })

  it('merges into the requested field with default preserve semantics', () => {
    const enricher = defineEnricher<{ id: string; plan?: string }>({
      name: 'tenant',
      field: 'tenant',
      compute: () => ({ id: 'computed', plan: 'free' }),
    })
    const event = baseEvent()
    event.tenant = { id: 'user-set' }
    const ctx = enrichCtx(event)
    enricher(ctx)
    expect(ctx.event.tenant).toEqual({ id: 'user-set', plan: 'free' })
  })

  it('overwrites when overwrite is true', () => {
    const enricher = defineEnricher<{ id: string }>({
      name: 'tenant',
      field: 'tenant',
      compute: () => ({ id: 'computed' }),
    }, { overwrite: true })
    const event = baseEvent()
    event.tenant = { id: 'user-set' }
    const ctx = enrichCtx(event)
    enricher(ctx)
    expect(ctx.event.tenant).toEqual({ id: 'computed' })
  })

  it('isolates errors from compute', () => {
    const enricher = defineEnricher<{ id: string }>({
      name: 'tenant',
      field: 'tenant',
      compute: () => {
        throw new Error('boom')
      },
    })
    const ctx = enrichCtx()
    enricher(ctx)
    expect(ctx.event.tenant).toBeUndefined()
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[evlog/tenant]'),
      expect.any(Error),
    )
  })

  it('writes primitive values to the event field', () => {
    const enricher = defineEnricher<string>({
      name: 'performance-tier',
      field: 'performanceTier',
      compute: ({ event }) => {
        const duration = event.duration as number | undefined
        if (duration === undefined) return undefined
        if (duration < 100) return 'fast'
        if (duration < 500) return 'normal'
        return 'slow'
      },
    })
    const event = baseEvent()
    event.duration = 50
    const ctx = enrichCtx(event)
    enricher(ctx)
    expect(ctx.event.performanceTier).toBe('fast')
  })

  it('preserves existing primitive value over enricher output', () => {
    const enricher = defineEnricher<string>({
      name: 'performance-tier',
      field: 'performanceTier',
      compute: () => 'fast',
    })
    const event = baseEvent()
    event.performanceTier = 'user-set'
    const ctx = enrichCtx(event)
    enricher(ctx)
    expect(ctx.event.performanceTier).toBe('user-set')
  })

  it('overwrites existing primitive when overwrite is true', () => {
    const enricher = defineEnricher<string>({
      name: 'performance-tier',
      field: 'performanceTier',
      compute: () => 'fast',
    }, { overwrite: true })
    const event = baseEvent()
    event.performanceTier = 'user-set'
    const ctx = enrichCtx(event)
    enricher(ctx)
    expect(ctx.event.performanceTier).toBe('fast')
  })
})

describe('composers', () => {
  it('composeEnrichers runs in order and isolates errors', async () => {
    const enrich = composeEnrichers([
      (ctx) => {
        ctx.event.a = 1
      },
      () => {
        throw new Error('mid failed')
      },
      (ctx) => {
        ctx.event.b = 2
      },
    ])
    const ctx = enrichCtx()
    await enrich(ctx)
    expect(ctx.event.a).toBe(1)
    expect(ctx.event.b).toBe(2)
    expect(console.error).toHaveBeenCalled()
  })

  it('composeDrains fans out concurrently and isolates errors', async () => {
    const calls: string[] = []
    const drain = composeDrains([
      () => {
        calls.push('a')
      },
      () => {
        throw new Error('b failed')
      },
      () => {
        calls.push('c')
      },
    ])
    await drain(drainCtx())
    expect(calls).toEqual(expect.arrayContaining(['a', 'c']))
    expect(console.error).toHaveBeenCalled()
  })

  it('composeKeep ORs shouldKeep across keepers', async () => {
    const keep = composeKeep([
      () => {
        // first keeper does nothing
      },
      (ctx) => {
        ctx.shouldKeep = true
      },
      () => {
        throw new Error('isolated')
      },
    ])
    const ctx: TailSamplingContext = { context: {}, shouldKeep: false }
    await keep(ctx)
    expect(ctx.shouldKeep).toBe(true)
    expect(console.error).toHaveBeenCalled()
  })

  it('composePlugins de-duplicates by name with last-wins', () => {
    const result = composePlugins(
      [{ name: 'a' }, { name: 'b' }],
      [{ name: 'a', drain: () => {} }],
    )
    expect(result).toHaveLength(2)
    expect(result.find(p => p.name === 'a')?.drain).toBeTypeOf('function')
  })
})

describe('plugin runner', () => {
  it('definePlugin returns the same plugin', () => {
    const plugin = definePlugin({ name: 'noop' })
    expect(plugin.name).toBe('noop')
  })

  it('drainPlugin / enricherPlugin wrap callbacks as plugins', () => {
    const drain = drainPlugin('axiom', () => {})
    const enricher = enricherPlugin('geo', () => {})
    expect(drain.name).toBe('axiom')
    expect(drain.drain).toBeTypeOf('function')
    expect(enricher.name).toBe('geo')
    expect(enricher.enrich).toBeTypeOf('function')
  })

  it('createPluginRunner reports correct hasX flags', () => {
    const runner = createPluginRunner([
      { name: 'a', enrich: () => {} },
      { name: 'b', drain: () => {} },
      { name: 'c', keep: () => {} },
      { name: 'd', extendLogger: () => {} },
    ])
    expect(runner.hasEnrich).toBe(true)
    expect(runner.hasDrain).toBe(true)
    expect(runner.hasKeep).toBe(true)
    expect(runner.hasExtendLogger).toBe(true)
    expect(runner.hasRequestLifecycle).toBe(false)
    expect(runner.hasClientLog).toBe(false)
  })

  it('createPluginRunner de-duplicates by name (last wins)', () => {
    const runner = createPluginRunner([
      { name: 'a', drain: () => {} },
      { name: 'a', enrich: () => {} },
    ])
    expect(runner.plugins).toHaveLength(1)
    expect(runner.hasDrain).toBe(false)
    expect(runner.hasEnrich).toBe(true)
  })

  it('runEnrich preserves order and isolates errors', async () => {
    const order: string[] = []
    const runner = createPluginRunner([
      {
        name: 'a',
        enrich: () => {
          order.push('a')
        },
      },
      {
        name: 'b',
        enrich: () => {
          throw new Error('b failed')
        },
      },
      {
        name: 'c',
        enrich: () => {
          order.push('c')
        },
      },
    ])
    const ctx = enrichCtx()
    await runner.runEnrich(ctx)
    expect(order).toEqual(['a', 'c'])
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[evlog/b]'),
      expect.any(Error),
    )
  })

  it('runDrain runs concurrently and isolates errors', async () => {
    const calls: string[] = []
    const runner = createPluginRunner([
      {
        name: 'a',
        drain: () => {
          calls.push('a')
        },
      },
      {
        name: 'b',
        drain: () => {
          throw new Error('b failed')
        },
      },
      {
        name: 'c',
        drain: () => {
          calls.push('c')
        },
      },
    ])
    await runner.runDrain(drainCtx())
    expect(calls).toEqual(expect.arrayContaining(['a', 'c']))
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[evlog/b]'),
      expect.any(Error),
    )
  })

  it('applyExtendLogger mutates the logger', () => {
    const runner = createPluginRunner([
      {
        name: 'audit',
        extendLogger: (logger) => {
          (logger as unknown as Record<string, unknown>).custom = () => 'hi'
        },
      },
    ])
    const logger = {
      set: () => {},
      setLevel: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
      emit: () => null,
      getContext: () => ({}),
    } as Parameters<typeof runner.applyExtendLogger>[0]
    runner.applyExtendLogger(logger)
    expect((logger as unknown as { custom: () => string }).custom()).toBe('hi')
  })

  it('getEmptyPluginRunner returns a stable empty runner', () => {
    expect(getEmptyPluginRunner().plugins).toHaveLength(0)
    expect(getEmptyPluginRunner().hasDrain).toBe(false)
  })
})

describe('plugin lifecycle wired through initLogger', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'test' }, pretty: false, silent: true })
  })

  it('runs plugin drain alongside global drain on log.info()', async () => {
    const pluginDrain = vi.fn()
    const standaloneDrain = vi.fn()
    initLogger({
      env: { service: 'test' },
      pretty: false,
      silent: true,
      drain: standaloneDrain,
      plugins: [{ name: 'test-plugin', drain: pluginDrain }],
    })

    const { log } = await import('../../src/logger')
    log.info({ action: 'test' })
    await vi.waitFor(() => {
      expect(standaloneDrain).toHaveBeenCalledTimes(1)
      expect(pluginDrain).toHaveBeenCalledTimes(1)
    })
    expect(standaloneDrain.mock.calls[0]?.[0]?.event?.action).toBe('test')
    expect(pluginDrain.mock.calls[0]?.[0]?.event?.action).toBe('test')
  })

  it('runs plugin setup at registration', async () => {
    const setup = vi.fn()
    initLogger({
      env: { service: 'unit-test' },
      pretty: false,
      silent: true,
      plugins: [{ name: 'with-setup', setup }],
    })
    await vi.waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[0]?.env?.service).toBe('unit-test')
  })
})

describe('defineHttpDrain', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('encodes a single batch and POSTs to the resolved URL', async () => {
    const drain = defineHttpDrain<{ apiKey: string }>({
      name: 'unit-test',
      resolve: () => ({ apiKey: 'secret' }),
      encode: (events, config) => ({
        url: 'https://example.test/ingest',
        headers: { 'Content-Type': 'application/json', 'X-Key': config.apiKey },
        body: JSON.stringify(events),
      }),
    })
    await drain(drainCtx({ ...baseEvent(), action: 'a' }))
    expect(fetch).toHaveBeenCalledWith(
      'https://example.test/ingest',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Key': 'secret' }),
        body: expect.stringContaining('"action":"a"'),
      }),
    )
  })

  it('skips when resolve returns null', async () => {
    const drain = defineHttpDrain<{ apiKey: string }>({
      name: 'unit-test',
      resolve: () => null,
      encode: () => ({ url: 'x', headers: {}, body: '' }),
    })
    await drain(drainCtx())
    expect(fetch).not.toHaveBeenCalled()
  })

  it('skips when encode returns null', async () => {
    const drain = defineHttpDrain<{ apiKey: string }>({
      name: 'unit-test',
      resolve: () => ({ apiKey: 'k' }),
      encode: () => null,
    })
    await drain(drainCtx())
    expect(fetch).not.toHaveBeenCalled()
  })

  it('forwards config.timeout/retries', async () => {
    const drain = defineHttpDrain<{ apiKey: string; timeout?: number; retries?: number }>({
      name: 'unit-test',
      resolve: () => ({ apiKey: 'k', timeout: 1234 }),
      encode: () => ({ url: 'https://x.test', headers: {}, body: '{}' }),
    })
    await drain(drainCtx())
    // Hard to introspect httpPost timeout; this exercise just ensures no throw.
    expect(fetch).toHaveBeenCalled()
  })

  it('logs errors from send and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))))
    const drain = defineHttpDrain<{ apiKey: string }>({
      name: 'unit-test',
      resolve: () => ({ apiKey: 'k' }),
      encode: () => ({ url: 'https://x.test', headers: {}, body: '{}' }),
    })
    await expect(drain(drainCtx())).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalled()
  })

  it('raw rejects on HTTP failure with a single attempt', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))))
    const drain = defineHttpDrain<{ apiKey: string }>({
      name: 'unit-test',
      resolve: () => ({ apiKey: 'k' }),
      encode: () => ({ url: 'https://x.test', headers: {}, body: '{}' }),
    })
    await expect(drain.raw(drainCtx())).rejects.toThrow('unit-test API error: 500')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('raw honors explicitly configured retries', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))))
    const drain = defineHttpDrain<{ apiKey: string; retries?: number }>({
      name: 'unit-test',
      resolve: () => ({ apiKey: 'k', retries: 1 }),
      encode: () => ({ url: 'https://x.test', headers: {}, body: '{}' }),
    })
    await expect(drain.raw(drainCtx())).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('gzips the body once and sends the same bytes on every retry', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('boom', { status: 503 }))))
    const body = JSON.stringify({ hello: 'world' })
    const drain = defineHttpDrain<{ apiKey: string; retries?: number }>({
      name: 'unit-test',
      resolve: () => ({ apiKey: 'k', retries: 1 }),
      encode: () => ({ url: 'https://x.test', headers: {}, body, compression: 'gzip' }),
    })
    await expect(drain.raw(drainCtx())).rejects.toThrow()

    const { calls } = vi.mocked(fetch).mock
    expect(calls).toHaveLength(2)
    const [first, second] = calls.map(([, init]) => init!)
    expect(first!.headers).toMatchObject({ 'Content-Encoding': 'gzip' })
    expect(second!.body).toBe(first!.body)
    expect(gunzipSync(first!.body as Uint8Array).toString()).toBe(body)
  })

  it('sends a binary body unchanged, and gzipped when asked', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))))
    const body = new Uint8Array([0x0A, 0x03, 0x00, 0xFF, 0x80])
    const plain = defineHttpDrain<{ apiKey: string }>({
      name: 'unit-test',
      resolve: () => ({ apiKey: 'k' }),
      encode: () => ({ url: 'https://x.test', headers: {}, body }),
    })
    const gzipped = defineHttpDrain<{ apiKey: string }>({
      name: 'unit-test',
      resolve: () => ({ apiKey: 'k' }),
      encode: () => ({ url: 'https://x.test', headers: {}, body, compression: 'gzip' }),
    })
    await plain.raw(drainCtx())
    await gzipped.raw(drainCtx())

    const [first, second] = vi.mocked(fetch).mock.calls.map(([, init]) => init!)
    expect(first!.body).toBe(body)
    expect(new Uint8Array(gunzipSync(second!.body as Uint8Array))).toEqual(body)
  })

  it('raw skips when resolve returns null', async () => {
    const drain = defineHttpDrain<{ apiKey: string }>({
      name: 'unit-test',
      resolve: () => null,
      encode: () => ({ url: 'https://x.test', headers: {}, body: '{}' }),
    })
    await expect(drain.raw(drainCtx())).resolves.toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('defineEvlog / toLoggerConfig / toMiddlewareOptions', () => {
  it('defineEvlog returns the same config object', () => {
    const config = defineEvlog({ service: 'shop' })
    expect(config.service).toBe('shop')
  })

  it('toLoggerConfig promotes service / environment into env', () => {
    const config = defineEvlog({ service: 'shop', environment: 'staging', sampling: { rates: { info: 50 } } })
    const logger = toLoggerConfig(config)
    expect(logger.env).toEqual({ service: 'shop', environment: 'staging' })
    expect(logger.sampling).toEqual({ rates: { info: 50 } })
    expect(logger.drain).toBeUndefined()
  })

  it('toLoggerConfig forwards drain and plugins', () => {
    const drain = vi.fn()
    const plugin = { name: 'p' }
    const logger = toLoggerConfig(defineEvlog({ drain, plugins: [plugin] }))
    expect(logger.drain).toBe(drain)
    expect(logger.plugins).toEqual([plugin])
  })

  it('toMiddlewareOptions picks middleware-only fields', () => {
    const drain = vi.fn()
    const enrich = vi.fn()
    const config = defineEvlog({
      service: 'shop',
      include: ['/api/**'],
      exclude: ['/health'],
      drain,
      enrich,
      plugins: [{ name: 'p' }],
    })
    const mw = toMiddlewareOptions(config)
    expect(mw.include).toEqual(['/api/**'])
    expect(mw.exclude).toEqual(['/health'])
    expect(mw.drain).toBe(drain)
    expect(mw.enrich).toBe(enrich)
    expect(mw.plugins).toEqual([{ name: 'p' }])
  })

  it('toMiddlewareOptions forwards waitUntil', () => {
    const waitUntil = vi.fn()
    const mw = toMiddlewareOptions(defineEvlog({ waitUntil }))
    expect(mw.waitUntil).toBe(waitUntil)
  })
})

describe('defineFrameworkIntegration', () => {
  it('extracts request, attaches logger, normalizes Web Headers', async () => {
    const attached: RequestLogger[] = []
    const integration = defineFrameworkIntegration<{ method: string; path: string; headers: Headers }>({
      name: 'test',
      extractRequest: (ctx) => ({
        method: ctx.method,
        path: ctx.path,
        headers: ctx.headers,
        requestId: ctx.headers.get('x-request-id') || undefined,
      }),
      attachLogger: (_ctx, logger) => {
        attached.push(logger)
      },
    })
    const ctx = {
      method: 'GET',
      path: '/health',
      headers: new Headers({ 'x-request-id': 'req-1', 'user-agent': 'vitest' }),
    }
    const { logger, finish, skipped, middlewareOptions, runWith } = integration.start(ctx, { drain: () => {} })
    expect(skipped).toBe(false)
    expect(attached).toEqual([logger])
    expect(middlewareOptions.headers?.['x-request-id']).toBe('req-1')
    const value = await runWith(() => 42)
    expect(value).toBe(42)
    await finish({ status: 200 })
  })

  it('runs the handler inside ALS when storage is provided', async () => {
    const storage = new AsyncLocalStorage<RequestLogger>()
    const integration = defineFrameworkIntegration<{ method: string; path: string }>({
      name: 'als-test',
      extractRequest: (ctx) => ({ method: ctx.method, path: ctx.path }),
      attachLogger: () => {},
      storage,
    })
    const { logger, runWith, finish } = integration.start(
      { method: 'POST', path: '/x' },
      { drain: () => {} },
    )
    let observed: RequestLogger | undefined
    await runWith(() => {
      observed = storage.getStore()
    })
    expect(observed).toBe(logger)
    await finish({ status: 204 })
  })

  it('wires extractWaitUntil into middleware options', async () => {
    const waitUntil = vi.fn()
    const integration = defineFrameworkIntegration<{ waitUntil: typeof waitUntil }>({
      name: 'serverless-test',
      extractRequest: () => ({ method: 'GET', path: '/api' }),
      attachLogger: () => {},
      extractWaitUntil: ctx => ctx.waitUntil,
    })

    const drain = vi.fn()
    const { finish } = integration.start({ waitUntil }, { drain, waitUntil: undefined })
    await finish({ status: 200 })
    expect(waitUntil).toHaveBeenCalledOnce()
  })

  it('prefers options.waitUntil over extractWaitUntil', async () => {
    const ctxWaitUntil = vi.fn()
    const optionsWaitUntil = vi.fn()
    const integration = defineFrameworkIntegration<{ waitUntil: typeof ctxWaitUntil }>({
      name: 'serverless-priority',
      extractRequest: () => ({ method: 'GET', path: '/api' }),
      attachLogger: () => {},
      extractWaitUntil: ctx => ctx.waitUntil,
    })

    const drain = vi.fn()
    const { finish } = integration.start(
      { waitUntil: ctxWaitUntil },
      { drain, waitUntil: optionsWaitUntil },
    )
    await finish({ status: 200 })
    expect(optionsWaitUntil).toHaveBeenCalledOnce()
    expect(ctxWaitUntil).not.toHaveBeenCalled()
  })
})
