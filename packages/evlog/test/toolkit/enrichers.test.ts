import { describe, expect, it } from 'vitest'
import type { EnrichContext, WideEvent } from '../../src/types'
import type { GeoInfo, UserAgentInfo } from '../../src/enrichers'
import { createGeoEnricher, createRequestSizeEnricher, createTraceContextEnricher, createUserAgentEnricher, createDefaultEnrichers } from '../../src/enrichers'

function createContext(headers: Record<string, string>, responseHeaders?: Record<string, string>): EnrichContext {
  const event: WideEvent = {
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'test',
    environment: 'test',
  }

  return {
    event,
    headers,
    response: responseHeaders ? { headers: responseHeaders, status: 200 } : undefined,
  }
}

describe('enrichers', () => {
  it('adds user agent info', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    })

    createUserAgentEnricher()(ctx)

    expect(ctx.event.userAgent).toBeDefined()
    expect((ctx.event.userAgent as UserAgentInfo).browser?.name).toBe('Safari')
  })

  it('adds geo info from cloud headers', () => {
    const ctx = createContext({
      'cf-ipcountry': 'FR',
      'cf-region': 'Île-de-France',
      'cf-region-code': 'IDF',
      'cf-city': 'Paris',
    })

    createGeoEnricher()(ctx)

    expect(ctx.event.geo).toMatchObject({
      country: 'FR',
      region: 'Île-de-France',
      regionCode: 'IDF',
      city: 'Paris',
    })
  })

  it('adds request/response size info', () => {
    const ctx = createContext(
      { 'content-length': '512' },
      { 'content-length': '1024' },
    )

    createRequestSizeEnricher()(ctx)

    expect(ctx.event.requestSize).toMatchObject({
      requestBytes: 512,
      responseBytes: 1024,
    })
  })

  it('adds trace context data', () => {
    const ctx = createContext({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      tracestate: 'congo=t61rcWkgMzE',
    })

    createTraceContextEnricher()(ctx)

    expect(ctx.event.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
    expect(ctx.event.parentSpanId).toBe('b7ad6b7169203331')
    expect(ctx.event.traceContext).toMatchObject({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      tracestate: 'congo=t61rcWkgMzE',
      parentSpanId: 'b7ad6b7169203331',
    })
  })

  it('does not attribute the caller span to the current request', () => {
    const ctx = createContext({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    })

    createTraceContextEnricher()(ctx)

    expect(ctx.event.spanId).toBeUndefined()
    expect(ctx.event.traceContext).toMatchObject({ spanId: undefined })
  })

  it('keeps a span id already set on the event', () => {
    const ctx = createContext({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    })
    ctx.event.spanId = '00f067aa0ba902b7'

    createTraceContextEnricher()(ctx)

    expect(ctx.event.spanId).toBe('00f067aa0ba902b7')
    expect(ctx.event.parentSpanId).toBe('b7ad6b7169203331')
    expect(ctx.event.traceContext).toMatchObject({ spanId: '00f067aa0ba902b7' })
  })
})

describe('enrichers - Vercel geo headers (T1)', () => {
  it('adds geo info from Vercel headers', () => {
    const ctx = createContext({
      'x-vercel-ip-country': 'US',
      'x-vercel-ip-country-region': 'California',
      'x-vercel-ip-country-region-code': 'CA',
      'x-vercel-ip-city': 'San Francisco',
      'x-vercel-ip-latitude': '37.7749',
      'x-vercel-ip-longitude': '-122.4194',
    })

    createGeoEnricher()(ctx)

    expect(ctx.event.geo).toMatchObject({
      country: 'US',
      region: 'California',
      regionCode: 'CA',
      city: 'San Francisco',
      latitude: 37.7749,
      longitude: -122.4194,
    })
  })

  it('prefers Vercel headers over Cloudflare when both present', () => {
    const ctx = createContext({
      'cf-ipcountry': 'FR',
      'x-vercel-ip-country': 'US',
    })

    createGeoEnricher()(ctx)

    expect((ctx.event.geo as GeoInfo).country).toBe('US')
  })
})

describe('enrichers - overwrite option (T2)', () => {
  it('preserves existing data when overwrite is false (default)', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    })

    ctx.event.userAgent = { raw: 'custom', browser: { name: 'CustomBrowser', version: '1.0' } }

    createUserAgentEnricher()(ctx)

    expect((ctx.event.userAgent as UserAgentInfo).browser?.name).toBe('CustomBrowser')
  })

  it('overwrites existing data when overwrite is true', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    })

    ctx.event.userAgent = { raw: 'custom', browser: { name: 'CustomBrowser', version: '1.0' } }

    createUserAgentEnricher({ overwrite: true })(ctx)

    expect((ctx.event.userAgent as UserAgentInfo).browser?.name).toBe('Chrome')
  })

  it('preserves existing geo data by default', () => {
    const ctx = createContext({
      'cf-ipcountry': 'FR',
    })

    ctx.event.geo = { country: 'DE' }

    createGeoEnricher()(ctx)

    expect((ctx.event.geo as GeoInfo).country).toBe('DE')
  })

  it('overwrites existing geo data when overwrite is true', () => {
    const ctx = createContext({
      'cf-ipcountry': 'FR',
    })

    ctx.event.geo = { country: 'DE' }

    createGeoEnricher({ overwrite: true })(ctx)

    expect((ctx.event.geo as GeoInfo).country).toBe('FR')
  })
})

describe('enrichers - mergeEventField behavior (T3)', () => {
  it('computed values are used when no existing data', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    })

    createUserAgentEnricher()(ctx)

    expect((ctx.event.userAgent as UserAgentInfo).browser?.name).toBe('Chrome')
    expect((ctx.event.userAgent as UserAgentInfo).os?.name).toBe('Windows')
  })

  it('user data takes precedence over computed for overlapping keys', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    })

    ctx.event.userAgent = { raw: 'custom-raw', browser: { name: 'MyBrowser' } }

    createUserAgentEnricher()(ctx)

    const ua = ctx.event.userAgent as UserAgentInfo
    expect(ua.browser?.name).toBe('MyBrowser')
    expect(ua.raw).toBe('custom-raw')
  })

  it('replaces non-object existing values', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    })

    ctx.event.userAgent = 'not-an-object'

    createUserAgentEnricher()(ctx)

    expect(typeof ctx.event.userAgent).toBe('object')
    expect((ctx.event.userAgent as UserAgentInfo).browser?.name).toBe('Chrome')
  })
})

describe('enrichers - browser detection (T4)', () => {
  it('detects Chrome', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    createUserAgentEnricher()(ctx)

    const ua = ctx.event.userAgent as UserAgentInfo
    expect(ua.browser?.name).toBe('Chrome')
    expect(ua.browser?.version).toBe('120.0.0.0')
  })

  it('detects Firefox', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    })

    createUserAgentEnricher()(ctx)

    const ua = ctx.event.userAgent as UserAgentInfo
    expect(ua.browser?.name).toBe('Firefox')
    expect(ua.browser?.version).toBe('121.0')
  })

  it('detects Edge', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    })

    createUserAgentEnricher()(ctx)

    const ua = ctx.event.userAgent as UserAgentInfo
    expect(ua.browser?.name).toBe('Edge')
    expect(ua.browser?.version).toBe('120.0.0.0')
  })

  it('detects Safari', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    })

    createUserAgentEnricher()(ctx)

    const ua = ctx.event.userAgent as UserAgentInfo
    expect(ua.browser?.name).toBe('Safari')
    expect(ua.browser?.version).toBe('17.0')
  })

  it('returns undefined browser for unknown user agents', () => {
    const ctx = createContext({
      'user-agent': 'custom-http-client/1.0',
    })

    createUserAgentEnricher()(ctx)

    const ua = ctx.event.userAgent as UserAgentInfo
    expect(ua.browser).toBeUndefined()
  })
})

describe('enrichers - device detection (T5)', () => {
  it('detects mobile device', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })

    createUserAgentEnricher()(ctx)

    expect((ctx.event.userAgent as UserAgentInfo).device?.type).toBe('mobile')
  })

  it('detects tablet device', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })

    createUserAgentEnricher()(ctx)

    expect((ctx.event.userAgent as UserAgentInfo).device?.type).toBe('tablet')
  })

  it('detects bot', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    })

    createUserAgentEnricher()(ctx)

    expect((ctx.event.userAgent as UserAgentInfo).device?.type).toBe('bot')
  })

  it('detects desktop device', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    createUserAgentEnricher()(ctx)

    expect((ctx.event.userAgent as UserAgentInfo).device?.type).toBe('desktop')
  })

  it('detects Android mobile', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    })

    createUserAgentEnricher()(ctx)

    expect((ctx.event.userAgent as UserAgentInfo).device?.type).toBe('mobile')
  })
})

describe('enrichers - OS detection (T6)', () => {
  it('detects Windows', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    createUserAgentEnricher()(ctx)

    const ua = ctx.event.userAgent as UserAgentInfo
    expect(ua.os?.name).toBe('Windows')
    expect(ua.os?.version).toBe('10.0')
  })

  it('detects macOS', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    })

    createUserAgentEnricher()(ctx)

    const ua = ctx.event.userAgent as UserAgentInfo
    expect(ua.os?.name).toBe('macOS')
    expect(ua.os?.version).toBe('13.4')
  })

  it('detects iOS', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })

    createUserAgentEnricher()(ctx)

    const ua = ctx.event.userAgent as UserAgentInfo
    expect(ua.os?.name).toBe('iOS')
    expect(ua.os?.version).toBe('17.0')
  })

  it('detects Android', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    })

    createUserAgentEnricher()(ctx)

    const ua = ctx.event.userAgent as UserAgentInfo
    expect(ua.os?.name).toBe('Android')
    expect(ua.os?.version).toBe('14')
  })

  it('detects Linux', () => {
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    createUserAgentEnricher()(ctx)

    const ua = ctx.event.userAgent as UserAgentInfo
    expect(ua.os?.name).toBe('Linux')
    expect(ua.os?.version).toBeUndefined()
  })
})

describe('enrichers - empty/missing headers (T8)', () => {
  it('no-ops when headers is undefined', () => {
    const event: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'test',
    }

    const ctx: EnrichContext = { event, headers: undefined }

    createUserAgentEnricher()(ctx)
    createGeoEnricher()(ctx)
    createRequestSizeEnricher()(ctx)
    createTraceContextEnricher()(ctx)

    expect(ctx.event.userAgent).toBeUndefined()
    expect(ctx.event.geo).toBeUndefined()
    expect(ctx.event.requestSize).toBeUndefined()
    expect(ctx.event.traceContext).toBeUndefined()
  })

  it('no-ops when headers is empty object', () => {
    const ctx = createContext({})

    createUserAgentEnricher()(ctx)
    createGeoEnricher()(ctx)
    createRequestSizeEnricher()(ctx)
    createTraceContextEnricher()(ctx)

    expect(ctx.event.userAgent).toBeUndefined()
    expect(ctx.event.geo).toBeUndefined()
    expect(ctx.event.requestSize).toBeUndefined()
    expect(ctx.event.traceContext).toBeUndefined()
  })

  it('handles missing response headers for requestSize enricher', () => {
    const ctx = createContext({ 'content-length': '512' })

    createRequestSizeEnricher()(ctx)

    expect(ctx.event.requestSize).toMatchObject({
      requestBytes: 512,
      responseBytes: undefined,
    })
  })
})

describe('createDefaultEnrichers', () => {
  it('composes user agent, geo, request size, and trace context enrichers', async () => {
    const enrich = createDefaultEnrichers()
    const ctx = createContext({
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'content-length': '512',
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      'x-vercel-ip-country': 'US',
      'x-vercel-ip-city': 'San Francisco',
    }, { 'content-length': '1024' })

    await enrich(ctx)

    expect(ctx.event.userAgent).toBeDefined()
    expect(ctx.event.geo).toBeDefined()
    expect(ctx.event.requestSize).toBeDefined()
    expect(ctx.event.traceContext).toBeDefined()
  })
})
