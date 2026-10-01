import type { EnrichContext } from '../types'
import { composeEnrichers } from '../shared/compose'
import { defineEnricher, type EnricherOptions } from '../shared/enricher'
import { getHeader, normalizeNumber } from '../shared/headers'

export type { EnricherOptions }

export interface UserAgentInfo {
  raw: string
  browser?: { name: string; version?: string }
  os?: { name: string; version?: string }
  device?: { type: 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown' }
}

export interface GeoInfo {
  country?: string
  region?: string
  regionCode?: string
  city?: string
  latitude?: number
  longitude?: number
}

export interface RequestSizeInfo {
  requestBytes?: number
  responseBytes?: number
}

export interface TraceContextInfo {
  traceparent?: string
  tracestate?: string
  traceId?: string
  /** Span of the current request, when an instrumentation already set `event.spanId`. */
  spanId?: string
  /** Caller span from the incoming `traceparent`. */
  parentSpanId?: string
}

function parseUserAgent(ua: string): UserAgentInfo {
  const lower = ua.toLowerCase()

  let deviceType: UserAgentInfo['device'] = { type: 'unknown' }
  if (/bot|crawl|spider|slurp|bingpreview/.test(lower)) {
    deviceType = { type: 'bot' }
  } else if (/ipad|tablet/.test(lower)) {
    deviceType = { type: 'tablet' }
  } else if (/mobi|iphone|android/.test(lower)) {
    deviceType = { type: 'mobile' }
  } else if (ua.length > 0) {
    deviceType = { type: 'desktop' }
  }

  const browserMatchers: Array<{ name: string, regex: RegExp }> = [
    { name: 'Edge', regex: /edg\/([\d.]+)/i },
    { name: 'Chrome', regex: /chrome\/([\d.]+)/i },
    { name: 'Firefox', regex: /firefox\/([\d.]+)/i },
    { name: 'Safari', regex: /version\/([\d.]+).*safari/i },
  ]

  let browser: UserAgentInfo['browser']
  for (const matcher of browserMatchers) {
    const match = ua.match(matcher.regex)
    if (match) {
      browser = { name: matcher.name, version: match[1] }
      break
    }
  }

  let os: UserAgentInfo['os']
  if (/windows nt/i.test(ua)) {
    const match = ua.match(/windows nt ([\d.]+)/i)
    os = { name: 'Windows', version: match?.[1] }
  } else if (/mac os x/i.test(ua) && !/iphone|ipad|ipod/i.test(ua)) {
    const match = ua.match(/mac os x ([\d_]+)/i)
    os = { name: 'macOS', version: match?.[1]?.replace(/_/g, '.') }
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    const match = ua.match(/os ([\d_]+)/i)
    os = { name: 'iOS', version: match?.[1]?.replace(/_/g, '.') }
  } else if (/android/i.test(ua)) {
    const match = ua.match(/android ([\d.]+)/i)
    os = { name: 'Android', version: match?.[1] }
  } else if (/linux/i.test(ua)) {
    os = { name: 'Linux' }
  }

  return {
    raw: ua,
    browser,
    os,
    device: deviceType,
  }
}

function parseTraceparent(traceparent: string): Pick<TraceContextInfo, 'traceId' | 'parentSpanId'> | undefined {
  const match = traceparent.match(/^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/i)
  if (!match) return undefined
  return { traceId: match[1], parentSpanId: match[2] }
}

/**
 * Enrich events with parsed user agent data.
 * Sets `event.userAgent` with `UserAgentInfo` shape: `{ raw, browser?, os?, device? }`.
 */
export function createUserAgentEnricher(options: EnricherOptions = {}): (ctx: EnrichContext) => void {
  return defineEnricher<UserAgentInfo>({
    name: 'userAgent',
    field: 'userAgent',
    compute: ({ headers }) => {
      const ua = getHeader(headers, 'user-agent')
      return ua ? parseUserAgent(ua) : undefined
    },
  }, options)
}

/**
 * Enrich events with geo data from platform headers.
 * Sets `event.geo` with `GeoInfo` shape: `{ country?, region?, regionCode?, city?, latitude?, longitude? }`.
 *
 * Supports Vercel (`x-vercel-ip-*`) headers out of the box.
 *
 * **Cloudflare note:** Only `cf-ipcountry` is an actual HTTP header added by Cloudflare.
 * The `cf-region`, `cf-city`, `cf-latitude`, `cf-longitude` headers are NOT standard
 * Cloudflare headers — they are properties of `request.cf` which is not exposed as HTTP
 * headers. For full geo data on Cloudflare, write a custom enricher that reads `request.cf`
 * or use a Workers middleware to copy `cf` properties into custom headers.
 */
export function createGeoEnricher(options: EnricherOptions = {}): (ctx: EnrichContext) => void {
  return defineEnricher<GeoInfo>({
    name: 'geo',
    field: 'geo',
    compute: ({ headers }) => {
      if (!headers) return undefined
      const geo: GeoInfo = {
        country: getHeader(headers, 'x-vercel-ip-country') ?? getHeader(headers, 'cf-ipcountry'),
        region: getHeader(headers, 'x-vercel-ip-country-region') ?? getHeader(headers, 'cf-region'),
        regionCode: getHeader(headers, 'x-vercel-ip-country-region-code') ?? getHeader(headers, 'cf-region-code'),
        city: getHeader(headers, 'x-vercel-ip-city') ?? getHeader(headers, 'cf-city'),
        latitude: normalizeNumber(getHeader(headers, 'x-vercel-ip-latitude') ?? getHeader(headers, 'cf-latitude')),
        longitude: normalizeNumber(getHeader(headers, 'x-vercel-ip-longitude') ?? getHeader(headers, 'cf-longitude')),
      }
      return Object.values(geo).every(value => value === undefined) ? undefined : geo
    },
  }, options)
}

/**
 * Enrich events with request/response payload sizes.
 * Sets `event.requestSize` with `RequestSizeInfo` shape: `{ requestBytes?, responseBytes? }`.
 */
export function createRequestSizeEnricher(options: EnricherOptions = {}): (ctx: EnrichContext) => void {
  return defineEnricher<RequestSizeInfo>({
    name: 'requestSize',
    field: 'requestSize',
    compute: ({ headers, response }) => {
      const requestBytes = normalizeNumber(getHeader(headers, 'content-length'))
      const responseBytes = normalizeNumber(getHeader(response?.headers, 'content-length'))
      if (requestBytes === undefined && responseBytes === undefined) return undefined
      return { requestBytes, responseBytes }
    },
  }, options)
}

/**
 * Enrich events with W3C trace context data.
 * Sets `event.traceContext` with `TraceContextInfo` shape: `{ traceparent?, tracestate?, traceId?, spanId?, parentSpanId? }`.
 * Also sets `event.traceId` and `event.parentSpanId` at the top level.
 *
 * The span id in an incoming `traceparent` belongs to the caller, so it is recorded as
 * `parentSpanId`. `event.spanId` is left to whatever creates the server span.
 */
export function createTraceContextEnricher(options: EnricherOptions = {}): (ctx: EnrichContext) => void {
  const enricher = defineEnricher<TraceContextInfo>({
    name: 'traceContext',
    field: 'traceContext',
    compute: ({ event, headers }) => {
      const traceparent = getHeader(headers, 'traceparent')
      const tracestate = getHeader(headers, 'tracestate')
      if (!traceparent && !tracestate) return undefined
      const parsed = traceparent ? parseTraceparent(traceparent) : undefined
      return {
        traceparent,
        tracestate,
        traceId: parsed?.traceId ?? (event.traceId as string | undefined),
        spanId: event.spanId as string | undefined,
        parentSpanId: parsed?.parentSpanId ?? (event.parentSpanId as string | undefined),
      }
    },
  }, options)

  // Trace context also pins traceId/parentSpanId at the top level for transports that
  // expect them outside the nested object.
  return (ctx) => {
    enricher(ctx)
    const merged = ctx.event.traceContext as TraceContextInfo | undefined
    if (!merged) return
    if (merged.traceId && (options.overwrite || ctx.event.traceId === undefined)) {
      ctx.event.traceId = merged.traceId
    }
    if (merged.parentSpanId && (options.overwrite || ctx.event.parentSpanId === undefined)) {
      ctx.event.parentSpanId = merged.parentSpanId
    }
  }
}

/**
 * Compose every built-in enricher into a single async enricher, in the order
 * `userAgent → geo → requestSize → traceContext`.
 *
 * Drop-in shorthand for the most common middleware setup:
 *
 * ```ts
 * import { createDefaultEnrichers } from 'evlog/enrichers'
 *
 * app.use(evlog({ enrich: createDefaultEnrichers() }))
 * ```
 */
export function createDefaultEnrichers(options: EnricherOptions = {}): (ctx: EnrichContext) => Promise<void> {
  return composeEnrichers(
    [
      createUserAgentEnricher(options),
      createGeoEnricher(options),
      createRequestSizeEnricher(options),
      createTraceContextEnricher(options),
    ],
    { name: 'default-enrichers' },
  )
}
