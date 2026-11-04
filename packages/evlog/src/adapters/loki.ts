import type { WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { formatPublicEnvKeys, resolveAdapterConfig } from '../shared/config'
import type { HttpDrainRequest } from '../shared/drain'
import { defineHttpDrain, sendEncodedDrainRequest } from '../shared/drain'
import { trimTrailingSlashes } from '../utils'

/** Default Loki push path appended to {@link LokiConfig.endpoint}. */
const LOKI_PUSH_PATH = '/loki/api/v1/push'

/**
 * Labels Loki indexes by default. Kept deliberately small — Loki charges for
 * label cardinality, and everything else stays queryable inside the JSON log
 * line via `| json`.
 */
const DEFAULT_LABELS = ['service', 'environment', 'level'] as const

export interface LokiConfig {
  /**
   * Base URL of the Loki instance, without the push path.
   *
   * @example `http://localhost:3100`
   * @example `https://logs-prod-eu-west-0.grafana.net`
   */
  endpoint: string
  /**
   * API token. On Grafana Cloud, pair it with {@link LokiConfig.user} — the two
   * are sent as HTTP Basic credentials. Without a `user` it is sent as
   * `Authorization: Bearer`.
   */
  apiKey?: string
  /**
   * Grafana Cloud instance ID (the numeric user for the Loki datasource).
   * Presence of this field switches authentication to Basic.
   */
  user?: string
  /**
   * Tenant for multi-tenant self-hosted Loki, sent as `X-Scope-OrgID`.
   * Independent of `apiKey` — single-tenant instances need neither.
   */
  tenantId?: string
  /**
   * Wide event fields promoted to Loki stream labels.
   * Defaults to `['service', 'environment', 'level']`.
   *
   * Keep this list short and low-cardinality: never add `requestId`, `userId`,
   * or `path`, which would create a new stream per value.
   */
  labelFields?: string[]
  /** Static labels merged into every stream (e.g. `{ region: 'eu-west-1' }`). */
  labels?: Record<string, string>
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
  /** Number of retry attempts on transient failures. Default: 2 */
  retries?: number
}

const LOKI_FIELDS: ConfigField<LokiConfig>[] = [
  { key: 'endpoint', env: ['NUXT_LOKI_ENDPOINT', 'LOKI_ENDPOINT', 'LOKI_URL'] },
  { key: 'apiKey', env: ['NUXT_LOKI_API_KEY', 'LOKI_API_KEY', 'GRAFANA_API_KEY'] },
  { key: 'user', env: ['NUXT_LOKI_USER', 'LOKI_USER', 'GRAFANA_USER'] },
  { key: 'tenantId', env: ['NUXT_LOKI_TENANT_ID', 'LOKI_TENANT_ID'] },
  { key: 'labelFields' },
  { key: 'labels' },
  { key: 'timeout' },
  { key: 'retries' },
]

/** Resolve the push URL, tolerating an endpoint that already carries the path. */
export function resolveLokiPushUrl(endpoint: string): string {
  const trimmed = trimTrailingSlashes(endpoint)
  return trimmed.endsWith(LOKI_PUSH_PATH) ? trimmed : `${trimmed}${LOKI_PUSH_PATH}`
}

/** Loki requires nanosecond epoch strings for entry timestamps. */
export function toLokiTimestamp(timestamp: string): string {
  const ms = Date.parse(timestamp)
  const safeMs = Number.isFinite(ms) ? ms : Date.now()
  return `${safeMs}000000`
}

/**
 * Build the Loki stream labels for one event.
 *
 * Only `labelFields` present on the event and holding a string/number/boolean
 * become labels — objects would explode cardinality and are left in the line.
 */
export function toLokiLabels(event: WideEvent, config: Pick<LokiConfig, 'labelFields' | 'labels'>): Record<string, string> {
  const fields = config.labelFields ?? [...DEFAULT_LABELS]
  const labels: Record<string, string> = { ...config.labels }

  for (const field of fields) {
    const value = (event as Record<string, unknown>)[field]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      labels[field] = String(value)
    }
  }

  return labels
}

interface LokiStream {
  stream: Record<string, string>
  values: [string, string][]
}

/**
 * Group events into Loki streams by label set. Loki rejects a push whose
 * entries are out of order within a stream, so each stream's values are sorted
 * by timestamp.
 *
 * The full wide event is the log line (JSON), queryable with `| json`.
 */
export function buildLokiPayload(events: WideEvent[], config: Pick<LokiConfig, 'labelFields' | 'labels'>): { streams: LokiStream[] } {
  const byLabels = new Map<string, LokiStream>()

  for (const event of events) {
    const labels = toLokiLabels(event, config)
    const key = JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)))
    const entry: [string, string] = [toLokiTimestamp(event.timestamp), JSON.stringify(event)]

    const existing = byLabels.get(key)
    if (existing) existing.values.push(entry)
    else byLabels.set(key, { stream: labels, values: [entry] })
  }

  const streams = Array.from(byLabels.values())
  for (const stream of streams) {
    stream.values.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  }
  return { streams }
}

/**
 * Base64 for HTTP Basic credentials, safe on every runtime evlog targets.
 *
 * `btoa` is used rather than `Buffer` because adapters must run on Cloudflare
 * Workers and other edge runtimes, where `Buffer` is absent without
 * `nodejs_compat`. `btoa` throws above U+00FF, so the value is UTF-8 encoded
 * first — a password with an accent would otherwise fail at drain time.
 */
function toBasicCredentials(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function buildHeaders(config: LokiConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (config.apiKey && config.user) {
    // Grafana Cloud: instance ID + token as HTTP Basic.
    headers.Authorization = `Basic ${toBasicCredentials(config.user, config.apiKey)}`
  } else if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`
  }

  if (config.tenantId) headers['X-Scope-OrgID'] = config.tenantId

  return headers
}

/**
 * Encode a batch of wide events into the Loki push request. Shared by
 * {@link createLokiDrain} and {@link sendBatchToLoki}.
 */
function encodeLokiRequest(events: WideEvent[], config: LokiConfig): HttpDrainRequest {
  return {
    url: resolveLokiPushUrl(config.endpoint),
    headers: buildHeaders(config),
    body: JSON.stringify(buildLokiPayload(events, config)),
  }
}

/**
 * Create a drain that pushes wide events to [Grafana Loki](https://grafana.com/docs/loki/latest/reference/loki-http-api/#ingest-logs).
 *
 * Each event is pushed as a JSON log line under a small, low-cardinality label
 * set (`service`, `environment`, `level` by default), so everything else stays
 * queryable with `| json` without inflating Loki's index.
 *
 * Configuration priority (highest to lowest):
 * 1. Overrides passed to `createLokiDrain()`
 * 2. `runtimeConfig.evlog.loki`
 * 3. `runtimeConfig.loki`
 * 4. Environment variables: `LOKI_ENDPOINT`, `LOKI_API_KEY`, `LOKI_USER`, `LOKI_TENANT_ID`
 *
 * @example
 * ```ts
 * // Self-hosted, single tenant — endpoint is all you need
 * initLogger({ drain: createLokiDrain({ endpoint: 'http://localhost:3100' }) })
 *
 * // Grafana Cloud — instance ID + token are sent as Basic auth
 * initLogger({ drain: createLokiDrain({
 *   endpoint: 'https://logs-prod-eu-west-0.grafana.net',
 *   user: '123456',
 *   apiKey: process.env.GRAFANA_API_KEY,
 * }) })
 * ```
 */
export function createLokiDrain(overrides?: Partial<LokiConfig>) {
  return defineHttpDrain<LokiConfig>({
    name: 'loki',
    label: 'Loki',
    resolve: async () => {
      const config = await resolveAdapterConfig<LokiConfig>('loki', LOKI_FIELDS, overrides)
      if (!config.endpoint) {
        console.error(`[evlog/loki] Missing endpoint. Set ${formatPublicEnvKeys(['NUXT_LOKI_ENDPOINT', 'LOKI_ENDPOINT', 'LOKI_URL'])} env var or pass endpoint to createLokiDrain()`)
        return null
      }
      return config as LokiConfig
    },
    encode: encodeLokiRequest,
  })
}

/**
 * Send a single wide event to Loki.
 */
export async function sendToLoki(event: WideEvent, config: LokiConfig): Promise<void> {
  await sendBatchToLoki([event], config)
}

/**
 * Send a batch of wide events to Loki in one push.
 */
export async function sendBatchToLoki(events: WideEvent[], config: LokiConfig): Promise<void> {
  if (events.length === 0) return
  await sendEncodedDrainRequest(encodeLokiRequest(events, config), {
    label: 'Loki',
    source: 'loki',
    timeout: config.timeout,
    retries: config.retries,
  })
}
