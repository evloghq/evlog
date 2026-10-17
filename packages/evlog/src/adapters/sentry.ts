import type { WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { formatPublicEnvKeys, resolveAdapterConfig } from '../shared/config'
import type { HttpDrainRequest } from '../shared/drain'
import { defineDrain, sendEncodedDrainRequest } from '../shared/drain'
import { parseStackFrames } from '../shared/pretty-error'
import { OTEL_SEVERITY_NUMBER } from '../shared/severity'
import { EVLOG_VERSION } from '../shared/http'

export interface SentryConfig {
  /** Sentry DSN */
  dsn: string
  /** Environment override (defaults to event.environment) */
  environment?: string
  /** Release version override (defaults to event.version) */
  release?: string
  /** Additional tags to attach as attributes */
  tags?: Record<string, string>
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
  /** Number of retry attempts on transient failures. Default: 2 */
  retries?: number
  /**
   * Also send `error` and `fatal` wide events as Sentry error events, so they open
   * issues and trigger issue alerts. The issue carries the wide event's `trace_id`.
   * Events with a 4xx status are not sent as issues.
   * Default: false
   */
  issues?: boolean
}

/** Sentry Log attribute value with type annotation */
export interface SentryAttributeValue {
  value: string | number | boolean
  type: 'string' | 'integer' | 'double' | 'boolean'
}

/** Sentry Structured Log payload */
export interface SentryLog {
  timestamp: number
  trace_id: string
  /** The active span, when the wide event has one */
  span_id?: string
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  body: string
  severity_number: number
  attributes?: Record<string, SentryAttributeValue>
}

/** Sentry error event payload, sent for `error` and `fatal` wide events when `issues` is set */
export interface SentryErrorEvent {
  event_id: string
  timestamp: number
  platform: 'javascript'
  level: 'error' | 'fatal'
  logger: 'evlog'
  environment?: string
  release?: string
  transaction?: string
  exception: { values: Array<{ type: string, value: string, stacktrace?: { frames: SentryStackFrame[] } }> }
  /** Set only when the error has no stack, so grouping ignores ids in the message. */
  fingerprint?: string[]
  contexts: { trace: { trace_id: string, span_id: string, parent_span_id?: string } }
  tags: Record<string, string>
  user?: { id: string }
}

/** Sentry stack frame, ordered oldest call first */
export interface SentryStackFrame {
  filename: string
  abs_path: string
  function?: string
  lineno?: number
  colno?: number
  in_app: boolean
}

interface SentryDsnParts {
  publicKey: string
  secretKey?: string
  projectId: string
  origin: string
  basePath: string
}

const SENTRY_FIELDS: ConfigField<SentryConfig>[] = [
  { key: 'dsn', env: ['NUXT_SENTRY_DSN', 'SENTRY_DSN'] },
  { key: 'environment', env: ['NUXT_SENTRY_ENVIRONMENT', 'SENTRY_ENVIRONMENT'] },
  { key: 'release', env: ['NUXT_SENTRY_RELEASE', 'SENTRY_RELEASE'] },
  { key: 'tags' },
  { key: 'timeout' },
  { key: 'retries' },
  { key: 'issues' },
]

function parseSentryDsn(dsn: string): SentryDsnParts {
  const url = new URL(dsn)
  const publicKey = url.username
  if (!publicKey) {
    throw new Error('Invalid Sentry DSN: missing public key')
  }

  const secretKey = url.password || undefined

  const pathParts = url.pathname.split('/').filter(Boolean)
  const projectId = pathParts.pop()
  if (!projectId) {
    throw new Error('Invalid Sentry DSN: missing project ID')
  }

  const basePath = pathParts.length > 0 ? `/${pathParts.join('/')}` : ''

  return {
    publicKey,
    secretKey,
    projectId,
    origin: `${url.protocol}//${url.host}`,
    basePath,
  }
}

function getSentryEnvelopeUrl(dsn: string): { url: string, authHeader: string } {
  const { publicKey, secretKey, projectId, origin, basePath } = parseSentryDsn(dsn)
  const url = `${origin}${basePath}/api/${projectId}/envelope/`
  let authHeader = `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=evlog`
  if (secretKey) {
    authHeader += `, sentry_secret=${secretKey}`
  }
  return { url, authHeader }
}

function createTraceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().replace(/-/g, '')
  }

  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** SDK identity Sentry expects on every log (`sentry.sdk.*` attributes) and on envelope headers. */
const SENTRY_SDK = { name: 'evlog', version: EVLOG_VERSION } as const

// Generated ids are cached per event so a retried batch resends the same ids and Sentry drops the duplicate issue.
const tracedEvents = new WeakMap<WideEvent, WideEvent>()
const issueIds = new WeakMap<WideEvent, { eventId: string, spanId: string }>()

function cached<T>(cache: WeakMap<WideEvent, T>, event: WideEvent, create: () => T): T {
  const existing = cache.get(event)
  if (existing !== undefined) return existing
  const value = create()
  cache.set(event, value)
  return value
}

/** Give an event without a `traceId` one, so its log and its issue share it. */
function withTraceId(event: WideEvent): WideEvent {
  return nonEmptyString(event.traceId) ? event : cached(tracedEvents, event, () => ({ ...event, traceId: createTraceId() }))
}

function getErrorRecord(event: WideEvent): Record<string, unknown> {
  return (typeof event.error === 'object' && event.error !== null ? event.error : {}) as Record<string, unknown>
}

/** Client errors (a thrown 404, 401 or validation 400) are expected traffic, not issues. */
function isClientError(event: WideEvent): boolean {
  const error = getErrorRecord(event)
  const status = Number(error.status ?? error.statusCode ?? event.status)
  return status >= 400 && status < 500
}

function toSentryFrames(stack: unknown): SentryStackFrame[] {
  if (typeof stack !== 'string') return []
  return parseStackFrames(stack)
    .filter(frame => frame.file)
    .map(frame => ({
      filename: frame.file!,
      abs_path: frame.file!,
      ...(frame.fn ? { function: frame.fn } : {}),
      ...(frame.line ? { lineno: frame.line } : {}),
      ...(frame.column ? { colno: frame.column } : {}),
      in_app: frame.isApp,
    }))
    .reverse()
}

function getUserId(event: WideEvent): string | undefined {
  const user = typeof event.user === 'object' && event.user !== null ? event.user as Record<string, unknown> : {}
  return nonEmptyString(event.userId) ?? nonEmptyString(user.id)
}

function getFirstStringValue(event: WideEvent, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = event[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function toAttributeValue(value: unknown): SentryAttributeValue | undefined {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === 'string') {
    return { value, type: 'string' }
  }
  if (typeof value === 'boolean') {
    return { value, type: 'boolean' }
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { value, type: 'integer' }
    }
    return { value, type: 'double' }
  }
  return { value: JSON.stringify(value), type: 'string' }
}

export function toSentryLog(event: WideEvent, config: SentryConfig): SentryLog {
  const { timestamp, level, service, environment, version, ...rest } = event

  const body = getFirstStringValue(event, ['message', 'action', 'path'])
    ?? 'evlog wide event'

  const traceId = (typeof event.traceId === 'string' && event.traceId.length > 0)
    ? event.traceId
    : createTraceId()

  const attributes: Record<string, SentryAttributeValue> = {}

  const env = config.environment ?? environment
  if (env) {
    attributes['sentry.environment'] = { value: env, type: 'string' }
  }

  const rel = config.release ?? version
  if (typeof rel === 'string' && rel.length > 0) {
    attributes['sentry.release'] = { value: rel, type: 'string' }
  }

  attributes['service'] = { value: service, type: 'string' }

  if (config.tags) {
    for (const [key, value] of Object.entries(config.tags)) {
      attributes[key] = { value, type: 'string' }
    }
  }

  for (const [key, value] of Object.entries(rest)) {
    if (key === 'traceId' || key === 'spanId') continue
    if (value === undefined || value === null) continue
    const attr = toAttributeValue(value)
    if (attr) {
      attributes[key] = attr
    }
  }

  attributes['sentry.sdk.name'] = { value: SENTRY_SDK.name, type: 'string' }
  attributes['sentry.sdk.version'] = { value: SENTRY_SDK.version, type: 'string' }

  const spanId = nonEmptyString(event.spanId)

  return {
    timestamp: new Date(timestamp).getTime() / 1000,
    trace_id: traceId,
    ...(spanId ? { span_id: spanId } : {}),
    level: level as SentryLog['level'],
    body,
    severity_number: OTEL_SEVERITY_NUMBER[level] ?? 9,
    attributes,
  }
}

/**
 * Convert an `error` or `fatal` wide event to a Sentry error event. The trace
 * context comes from the event's `traceId`, `spanId` and `parentSpanId`, so the
 * issue links to the trace and its logs.
 */
export function toSentryErrorEvent(event: WideEvent, config: SentryConfig): SentryErrorEvent {
  const error = getErrorRecord(event)
  const method = nonEmptyString(event.method)
  const path = nonEmptyString(event.path)
  const transaction = method && path ? `${method} ${path}` : nonEmptyString(event.action) ?? path
  const parentSpanId = nonEmptyString(event.parentSpanId)
  const environment = config.environment ?? event.environment
  const release = config.release ?? nonEmptyString(event.version)
  const type = nonEmptyString(error.name) ?? 'Error'
  const frames = toSentryFrames(error.stack)
  const userId = getUserId(event)
  const ids = cached(issueIds, event, () => ({ eventId: createTraceId(), spanId: createTraceId().slice(0, 16) }))

  return {
    event_id: ids.eventId,
    timestamp: new Date(event.timestamp).getTime() / 1000,
    platform: 'javascript',
    level: event.level === 'fatal' ? 'fatal' : 'error',
    logger: 'evlog',
    ...(environment ? { environment } : {}),
    ...(release ? { release } : {}),
    ...(transaction ? { transaction } : {}),
    exception: {
      values: [
        {
          type,
          value: nonEmptyString(error.message) ?? getFirstStringValue(event, ['message', 'action', 'path']) ?? 'evlog wide event',
          ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
        }
      ],
    },
    ...(frames.length > 0 ? {} : { fingerprint: transaction ? [type, transaction] : [type] }),
    contexts: {
      trace: {
        trace_id: nonEmptyString(event.traceId) ?? createTraceId(),
        span_id: nonEmptyString(event.spanId) ?? ids.spanId,
        ...(parentSpanId ? { parent_span_id: parentSpanId } : {}),
      },
    },
    tags: { service: event.service, ...config.tags },
    ...(userId ? { user: { id: userId } } : {}),
  }
}

/**
 * Build the Sentry Envelope body for a list of logs.
 *
 * Envelope format (line-delimited):
 * - Line 1: Envelope headers (dsn, sdk, sent_at)
 * - Line 2: Item header (type: log, item_count, content_type)
 * - Line 3: Item payload ({"items": [...]})
 */
function buildEnvelopeBody(logs: SentryLog[], dsn: string): string {
  const envelopeHeader = JSON.stringify({
    dsn,
    sdk: SENTRY_SDK,
    sent_at: new Date().toISOString(),
  })

  const itemHeader = JSON.stringify({
    type: 'log',
    item_count: logs.length,
    content_type: 'application/vnd.sentry.items.log+json',
  })

  const itemPayload = JSON.stringify({ items: logs })

  return `${envelopeHeader}\n${itemHeader}\n${itemPayload}\n`
}

/**
 * Create a drain function for sending logs to Sentry.
 *
 * Sends wide events as Sentry Structured Logs, visible in Explore > Logs
 * in the Sentry dashboard.
 *
 * Configuration priority (highest to lowest):
 * 1. Overrides passed to createSentryDrain()
 * 2. runtimeConfig.evlog.sentry
 * 3. runtimeConfig.sentry
 * 4. Environment variables: SENTRY_*
 *
 * @example
 * ```ts
 * // Zero config - just set SENTRY_DSN env var
 * nitroApp.hooks.hook('evlog:drain', createSentryDrain())
 *
 * // With overrides
 * nitroApp.hooks.hook('evlog:drain', createSentryDrain({
 *   dsn: 'https://public@o0.ingest.sentry.io/123',
 * }))
 * ```
 */
export function createSentryDrain(overrides?: Partial<SentryConfig>) {
  return defineDrain<SentryConfig>({
    name: 'sentry',
    resolve: async () => {
      const config = await resolveAdapterConfig<SentryConfig>('sentry', SENTRY_FIELDS, overrides)
      if (!config.dsn) {
        console.error(`[evlog/sentry] Missing DSN. Set ${formatPublicEnvKeys(['NUXT_SENTRY_DSN', 'SENTRY_DSN'])} env var or pass to createSentryDrain()`)
        return null
      }
      return config as SentryConfig
    },
    send: sendBatchToSentry,
    // Raw callers (the pipeline) own retries: single attempt unless the config sets retries explicitly.
    rawSend: (events, config) => sendBatchToSentry(events, { ...config, retries: config.retries ?? 0 }),
  })
}

function getSentryEnvelopeRequest(config: SentryConfig, body: string): HttpDrainRequest {
  const { url, authHeader } = getSentryEnvelopeUrl(config.dsn)
  return {
    url,
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': authHeader,
    },
    body,
  }
}

/**
 * Encode a batch of wide events into the Sentry envelope request carrying
 * their structured logs.
 */
function encodeSentryRequest(events: WideEvent[], config: SentryConfig): HttpDrainRequest {
  const logs = events.map(event => toSentryLog(event, config))
  return getSentryEnvelopeRequest(config, buildEnvelopeBody(logs, config.dsn))
}

/** Sentry's log protocol caps a log envelope at 100 items: larger batches are split into several envelopes. */
const SENTRY_MAX_LOGS_PER_ENVELOPE = 100

/** An envelope holds at most one error event, so each issue gets its own request. */
function encodeSentryErrorEventRequest(event: SentryErrorEvent, config: SentryConfig): HttpDrainRequest {
  const envelopeHeader = JSON.stringify({ event_id: event.event_id, dsn: config.dsn, sdk: SENTRY_SDK, sent_at: new Date().toISOString() })
  const itemHeader = JSON.stringify({ type: 'event', content_type: 'application/json' })
  return getSentryEnvelopeRequest(config, `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}\n`)
}

/**
 * Send a single event to Sentry as a structured log.
 *
 * @example
 * ```ts
 * await sendToSentry(event, {
 *   dsn: process.env.SENTRY_DSN!,
 * })
 * ```
 */
export async function sendToSentry(event: WideEvent, config: SentryConfig): Promise<void> {
  await sendBatchToSentry([event], config)
}

/**
 * Send a batch of events to Sentry as structured logs via the Envelope endpoint.
 * With `issues`, `error` and `fatal` events without a 4xx status are also sent
 * as error events, one request at a time after the logs. Only a failed log
 * request rejects: issues are best-effort, and the first failed issue stops
 * the remaining ones for this batch.
 *
 * @example
 * ```ts
 * await sendBatchToSentry(events, {
 *   dsn: process.env.SENTRY_DSN!,
 * })
 * ```
 */
export async function sendBatchToSentry(events: WideEvent[], config: SentryConfig): Promise<void> {
  if (events.length === 0) return
  const traced = events.map(withTraceId)
  const options = { label: 'Sentry', source: 'sentry', timeout: config.timeout, retries: config.retries }
  for (let start = 0; start < traced.length; start += SENTRY_MAX_LOGS_PER_ENVELOPE) {
    await sendEncodedDrainRequest(encodeSentryRequest(traced.slice(start, start + SENTRY_MAX_LOGS_PER_ENVELOPE), config), options)
  }
  if (!config.issues) return

  const issues = traced.filter(event => (event.level === 'error' || event.level === 'fatal') && !isClientError(event))
  for (const [index, event] of issues.entries()) {
    try {
      await sendEncodedDrainRequest(encodeSentryErrorEventRequest(toSentryErrorEvent(event, config), config), options)
    } catch (error) {
      console.error(`[evlog/sentry] Failed to send issue, skipped ${issues.length - index - 1} more in this batch:`, error)
      return
    }
  }
}
