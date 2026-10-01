import type { WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { formatPublicEnvKeys, resolveAdapterConfig } from '../shared/config'
import type { HttpDrainRequest } from '../shared/drain'
import { defineHttpDrain, sendEncodedDrainRequest } from '../shared/drain'
import type { OtlpAttributeValue } from '../shared/event'
import { formatEventSummary, isPlainObject, toOtlpAttributeValue } from '../shared/event'
import { EVLOG_VERSION } from '../shared/http'
import { OTEL_SEVERITY_NUMBER, OTEL_SEVERITY_TEXT } from '../shared/severity'

/**
 * Shape of the emitted log record.
 *
 * - `'json'` — body carries the serialized event; each top-level field becomes
 *   one attribute, nested ones as a JSON string.
 * - `'compact'` — body is a one-line summary; nested fields flatten to dotted
 *   attributes (`user.id`), which is what backends facet and filter on.
 *
 * `'compact'` becomes the default in the next major.
 */
export type OTLPRecordShape = 'json' | 'compact'

export interface OTLPConfig {
  /** OTLP HTTP endpoint (e.g., http://localhost:4318) */
  endpoint: string
  /**
   * Log record shape. Default: `'json'`.
   * @see {@link OTLPRecordShape}
   */
  recordShape?: OTLPRecordShape
  /** Override service name (defaults to event.service) */
  serviceName?: string
  /** Additional resource attributes */
  resourceAttributes?: Record<string, string | number | boolean>
  /** Custom headers (e.g., for authentication) */
  headers?: Record<string, string>
  /**
   * Request body compression. Default: `'none'`. Falls back to
   * `OTEL_EXPORTER_OTLP_LOGS_COMPRESSION`, then `OTEL_EXPORTER_OTLP_COMPRESSION`.
   */
  compression?: 'gzip' | 'none'
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
  /** Number of retry attempts on transient failures. Default: 2 */
  retries?: number
}

/** OTLP Log Record structure */
export interface OTLPLogRecord {
  timeUnixNano: string
  severityNumber: number
  severityText: string
  body: { stringValue: string }
  attributes: Array<{
    key: string
    value: OtlpAttributeValue
  }>
  traceId?: string
  spanId?: string
}

/** OTLP Resource structure */
interface OTLPResource {
  attributes: Array<{
    key: string
    value: OtlpAttributeValue
  }>
}

/** OTLP Scope structure */
interface OTLPScope {
  name: string
  version?: string
}

/** OTLP ExportLogsServiceRequest structure */
interface ExportLogsServiceRequest {
  resourceLogs: Array<{
    resource: OTLPResource
    scopeLogs: Array<{
      scope: OTLPScope
      logRecords: OTLPLogRecord[]
    }>
  }>
}

const ENDPOINT_ENV = ['NUXT_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTLP_ENDPOINT']

const OTLP_FIELDS: ConfigField<OTLPConfig>[] = [
  { key: 'endpoint', env: ['NUXT_OTLP_ENDPOINT'] },
  { key: 'recordShape' },
  { key: 'serviceName', env: ['NUXT_OTLP_SERVICE_NAME', 'OTEL_SERVICE_NAME'] },
  { key: 'headers' },
  { key: 'resourceAttributes' },
  { key: 'compression', env: ['OTEL_EXPORTER_OTLP_LOGS_COMPRESSION', 'OTEL_EXPORTER_OTLP_COMPRESSION'] },
  { key: 'timeout' },
  { key: 'retries' },
]

/** Config after {@link createOTLPDrain} has read the `OTEL_*` environment. */
interface ResolvedOTLPConfig extends OTLPConfig {
  /** Complete logs URL from `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, posted to without appending `/v1/logs`. */
  logsUrl?: string
  /** Parsed `OTEL_RESOURCE_ATTRIBUTES`. Attributes evlog derives and `resourceAttributes` take precedence. */
  envResourceAttributes?: Record<string, string>
}

const TRACE_ID_PATTERN = /^[\da-f]{32}$/i
const SPAN_ID_PATTERN = /^[\da-f]{16}$/i

/** A W3C trace context id in OTLP's lowercase hex form, or `undefined` when malformed or all zeros. */
function toTraceContextId(value: unknown, pattern: RegExp): string | undefined {
  if (typeof value !== 'string' || !pattern.test(value) || /^0+$/.test(value)) return undefined
  return value.toLowerCase()
}

// Re-exposed under a local name to keep call-sites tight while delegating to
// the shared OTLP attribute encoder in `evlog/toolkit`.
const toAttributeValue = toOtlpAttributeValue

/**
 * Flatten nested plain objects into dotted attribute keys — `ai.costUsd`,
 * `error.message`. Arrays and non-plain objects are serialized as a single
 * value; indexing an array into `tools.0.name` would turn a list into
 * unbounded distinct attribute keys.
 */
function collectAttributes(
  value: Record<string, unknown>,
  prefix: string,
  out: OTLPLogRecord['attributes'],
): void {
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || child === null) continue
    const path = prefix ? `${prefix}.${key}` : key
    // An empty object flattens to no attribute at all, which would drop the
    // field, so it is serialized like any other leaf.
    if (isPlainObject(child) && Object.keys(child).length > 0) {
      collectAttributes(child, path, out)
      continue
    }
    out.push({ key: path, value: toAttributeValue(child) })
  }
}

/**
 * Convert an evlog WideEvent to an OTLP LogRecord.
 *
 * @param shape See {@link OTLPRecordShape}. Defaults to `'json'`.
 */
export function toOTLPLogRecord(event: WideEvent, shape: OTLPRecordShape = 'json'): OTLPLogRecord {
  const timestamp = new Date(event.timestamp).getTime() * 1_000_000 // Convert to nanoseconds

  const { level, ...rest } = event
  // A malformed id would be rejected in the record's trace fields, so it stays an ordinary attribute.
  const traceId = toTraceContextId(rest.traceId, TRACE_ID_PATTERN)
  const spanId = toTraceContextId(rest.spanId, SPAN_ID_PATTERN)
  if (traceId) delete (rest as Record<string, unknown>).traceId
  if (spanId) delete (rest as Record<string, unknown>).spanId
  // Remove base fields from rest (they're handled as resource attributes)
  delete (rest as Record<string, unknown>).timestamp
  delete (rest as Record<string, unknown>).service
  delete (rest as Record<string, unknown>).environment
  delete (rest as Record<string, unknown>).version
  delete (rest as Record<string, unknown>).commitHash
  delete (rest as Record<string, unknown>).region

  const attributes: OTLPLogRecord['attributes'] = []
  if (shape === 'compact') {
    collectAttributes(rest, '', attributes)
  } else {
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined && value !== null) {
        attributes.push({ key, value: toAttributeValue(value) })
      }
    }
  }

  const record: OTLPLogRecord = {
    timeUnixNano: String(timestamp),
    severityNumber: OTEL_SEVERITY_NUMBER[level] ?? 9,
    severityText: OTEL_SEVERITY_TEXT[level] ?? 'INFO',
    body: {
      stringValue: shape === 'compact'
        ? formatEventSummary(event) || event.service
        : JSON.stringify(event),
    },
    attributes,
  }

  if (traceId) record.traceId = traceId
  if (spanId) record.spanId = spanId

  return record
}

/**
 * Build OTLP resource attributes. Later sources replace earlier ones by key:
 * `OTEL_RESOURCE_ATTRIBUTES`, then the fields evlog derives from the event,
 * then `config.resourceAttributes`.
 */
function buildResourceAttributes(
  event: WideEvent,
  config: ResolvedOTLPConfig,
): OTLPResource['attributes'] {
  const attributes = new Map<string, string | number | boolean>(Object.entries(config.envResourceAttributes ?? {}))

  attributes.set('service.name', config.serviceName ?? event.service)
  if (event.environment) attributes.set('deployment.environment', event.environment)
  if (event.version) attributes.set('service.version', event.version)
  if (event.region) attributes.set('cloud.region', event.region)
  if (event.commitHash) attributes.set('vcs.commit.id', event.commitHash)

  for (const [key, value] of Object.entries(config.resourceAttributes ?? {})) {
    attributes.set(key, value)
  }

  return Array.from(attributes, ([key, value]) => ({ key, value: toAttributeValue(value) }))
}

/**
 * Parse the `key=value,key=value` list format of `OTEL_EXPORTER_OTLP_HEADERS`
 * and `OTEL_RESOURCE_ATTRIBUTES`. Values are percent-decoded after splitting,
 * so an encoded `%2C` stays inside its value.
 */
function parseOtelKeyValueList(list: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!list) return out
  for (const pair of list.split(',')) {
    const eqIndex = pair.indexOf('=')
    if (eqIndex <= 0) continue
    const key = pair.slice(0, eqIndex).trim()
    const value = decodePercentEncoded(pair.slice(eqIndex + 1).trim())
    if (key && value) out[key] = value
  }
  return out
}

/** A `%` outside a valid escape is kept as written, as OTel SDKs do, so one value cannot disable the drain. */
function decodePercentEncoded(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Headers from the environment. `OTEL_EXPORTER_OTLP_LOGS_HEADERS` replaces the generic headers by key. */
function getHeadersFromEnv(): Record<string, string> | undefined {
  const headers = {
    ...parseOtelKeyValueList(process.env.OTEL_EXPORTER_OTLP_HEADERS || process.env.OTLP_HEADERS || process.env.NUXT_OTLP_HEADERS),
    ...parseOtelKeyValueList(process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS),
  }
  if (Object.keys(headers).length > 0) return headers

  const auth = process.env.NUXT_OTLP_AUTH
  if (auth) {
    return { Authorization: auth }
  }

  return undefined
}

/**
 * Create a drain function for sending logs to an OTLP endpoint.
 *
 * Configuration priority (highest to lowest):
 * 1. Overrides passed to createOTLPDrain()
 * 2. runtimeConfig.evlog.otlp
 * 3. runtimeConfig.otlp
 * 4. Environment variables: OTEL_EXPORTER_OTLP_LOGS_ENDPOINT (used as the full
 *    logs URL), OTEL_EXPORTER_OTLP_ENDPOINT (or OTLP_ENDPOINT), OTEL_SERVICE_NAME,
 *    OTEL_EXPORTER_OTLP_[LOGS_]HEADERS, OTEL_EXPORTER_OTLP_[LOGS_]COMPRESSION,
 *    OTEL_RESOURCE_ATTRIBUTES
 *
 * @example
 * ```ts
 * // Zero config - reads from runtimeConfig or env vars
 * nitroApp.hooks.hook('evlog:drain', createOTLPDrain())
 *
 * // With overrides
 * nitroApp.hooks.hook('evlog:drain', createOTLPDrain({
 *   endpoint: 'http://localhost:4318',
 * }))
 * ```
 */
export function createOTLPDrain(overrides?: Partial<OTLPConfig>) {
  return defineHttpDrain<ResolvedOTLPConfig>({
    name: 'otlp',
    resolve: async () => {
      const config: Partial<ResolvedOTLPConfig> = await resolveAdapterConfig<OTLPConfig>('otlp', OTLP_FIELDS, overrides)

      // OTLP-specific: resolve headers from env if not provided via config
      if (!config.headers) {
        config.headers = getHeadersFromEnv()
      }

      if (!config.endpoint) {
        config.logsUrl = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || undefined
        config.endpoint = config.logsUrl || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTLP_ENDPOINT
      }
      if (!config.endpoint) {
        console.error(`[evlog/otlp] Missing endpoint. Set ${formatPublicEnvKeys(ENDPOINT_ENV)} env var, or pass to createOTLPDrain()`)
        return null
      }
      if (config.compression !== undefined && config.compression !== 'gzip' && config.compression !== 'none') {
        console.error(`[evlog/otlp] Unsupported compression "${config.compression}". Use "gzip" or "none".`)
        return null
      }
      config.envResourceAttributes = parseOtelKeyValueList(process.env.OTEL_RESOURCE_ATTRIBUTES)
      return config as ResolvedOTLPConfig
    },
    label: 'OTLP',
    encode: (events, config) => (events.length === 0 ? null : encodeOTLPRequest(events, config)),
  })
}

/**
 * Encode a batch of wide events into the OTLP/HTTP logs request. Shared by
 * {@link createOTLPDrain} and {@link sendBatchToOTLP}.
 */
function encodeOTLPRequest(events: WideEvent[], config: ResolvedOTLPConfig): HttpDrainRequest {
  return {
    url: config.logsUrl ?? `${config.endpoint.replace(/\/$/, '')}/v1/logs`,
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
    body: JSON.stringify(buildOTLPPayload(events, config)),
    compression: config.compression === 'gzip' ? 'gzip' : undefined,
  }
}

function buildOTLPPayload(events: WideEvent[], config: ResolvedOTLPConfig): ExportLogsServiceRequest {
  const grouped = new Map<string, WideEvent[]>()
  for (const event of events) {
    // Every field the resource is built from, so no event borrows another's resource.
    const key = JSON.stringify([event.service, event.environment, event.version, event.region, event.commitHash])
    const group = grouped.get(key)
    if (group) group.push(event)
    else grouped.set(key, [event])
  }
  return {
    resourceLogs: Array.from(grouped.values()).map(groupEvents => ({
      resource: { attributes: buildResourceAttributes(groupEvents[0]!, config) },
      scopeLogs: [
        {
          scope: { name: 'evlog', version: EVLOG_VERSION },
          logRecords: groupEvents.map(event => toOTLPLogRecord(event, config.recordShape)),
        },
      ],
    })),
  }
}

/**
 * Send a single event to an OTLP endpoint.
 *
 * @example
 * ```ts
 * await sendToOTLP(event, {
 *   endpoint: 'http://localhost:4318',
 * })
 * ```
 */
export async function sendToOTLP(event: WideEvent, config: OTLPConfig): Promise<void> {
  await sendBatchToOTLP([event], config)
}

/**
 * Send a batch of events to an OTLP endpoint.
 *
 * @example
 * ```ts
 * await sendBatchToOTLP(events, {
 *   endpoint: 'http://localhost:4318',
 * })
 * ```
 */
export async function sendBatchToOTLP(events: WideEvent[], config: OTLPConfig): Promise<void> {
  if (events.length === 0) return
  await sendEncodedDrainRequest(encodeOTLPRequest(events, config), {
    label: 'OTLP',
    source: 'otlp',
    timeout: config.timeout,
    retries: config.retries,
  })
}
