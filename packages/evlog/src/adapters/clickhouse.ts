import type { WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { formatPublicEnvKeys, resolveAdapterConfig } from '../shared/config'
import type { HttpDrainRequest } from '../shared/drain'
import { defineHttpDrain, sendEncodedDrainRequest } from '../shared/drain'
import { trimTrailingSlashes } from '../utils'

const DEFAULT_TABLE = 'evlog_events'
const DEFAULT_DATABASE = 'default'
const DEFAULT_USERNAME = 'default'

export interface ClickHouseConfig {
  /**
   * HTTP interface URL.
   *
   * @example `http://localhost:8123`
   * @example `https://abc123.eu-west-1.aws.clickhouse.cloud:8443`
   */
  endpoint: string
  /** Target database. Default: `default` */
  database?: string
  /** Target table. Default: `evlog_events` */
  table?: string
  /** Username. Default: `default` */
  username?: string
  /** Password. Omit for an unauthenticated local instance. */
  password?: string
  /**
   * Use [asynchronous inserts](https://clickhouse.com/docs/en/optimize/asynchronous-inserts).
   * ClickHouse batches small inserts server-side instead of creating one part
   * per request, which is what you want for log ingestion. Default: `true`
   */
  asyncInsert?: boolean
  /**
   * Wait for an async insert to be flushed before responding. Default: `false`
   * — fire-and-forget, so a drain never blocks a request on disk writes.
   * Only meaningful when `asyncInsert` is enabled.
   */
  waitForAsyncInsert?: boolean
  /**
   * Map a wide event to a table row. Defaults to {@link toClickHouseRow}.
   * Override it when your table has a different schema.
   */
  transform?: (event: WideEvent) => Record<string, unknown>
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
  /** Number of retry attempts on transient failures. Default: 2 */
  retries?: number
}

const CLICKHOUSE_FIELDS: ConfigField<ClickHouseConfig>[] = [
  { key: 'endpoint', env: ['NUXT_CLICKHOUSE_ENDPOINT', 'CLICKHOUSE_ENDPOINT', 'CLICKHOUSE_URL'] },
  { key: 'database', env: ['NUXT_CLICKHOUSE_DATABASE', 'CLICKHOUSE_DATABASE'] },
  { key: 'table', env: ['NUXT_CLICKHOUSE_TABLE', 'CLICKHOUSE_TABLE'] },
  { key: 'username', env: ['NUXT_CLICKHOUSE_USER', 'CLICKHOUSE_USER'] },
  { key: 'password', env: ['NUXT_CLICKHOUSE_PASSWORD', 'CLICKHOUSE_PASSWORD'] },
  { key: 'asyncInsert' },
  { key: 'waitForAsyncInsert' },
  { key: 'transform' },
  { key: 'timeout' },
  { key: 'retries' },
]

/** Read a string field off an event, or `undefined` when absent/not a string. */
function readString(event: WideEvent, key: string): string | undefined {
  const value = (event as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

const UINT32_MAX = 4_294_967_295

/**
 * Coerce a value to what `Nullable(UInt32)` accepts, or `null`.
 *
 * ClickHouse rejects the whole `JSONEachRow` batch on an out-of-range value, so
 * one odd event would drop every event sent with it.
 */
function readUInt32(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value >= 0 && value <= UINT32_MAX ? value : null
}

/**
 * Convert an ISO timestamp to ClickHouse's `DateTime64(3)` text format
 * (`YYYY-MM-DD HH:MM:SS.mmm`, UTC).
 */
export function toClickHouseDateTime(timestamp: string): string {
  const ms = Date.parse(timestamp)
  const date = new Date(Number.isFinite(ms) ? ms : Date.now())
  return date.toISOString().replace('T', ' ').replace('Z', '')
}

/**
 * Map a wide event onto the default `evlog_events` schema: typed columns for
 * the fields you filter and aggregate on, plus the complete event as JSON in
 * `data` so nothing is lost.
 *
 * See the adapter docs for the matching `CREATE TABLE`. Pass `transform` to
 * target a different schema.
 */
export function toClickHouseRow(event: WideEvent): Record<string, unknown> {
  const { durationMs, error, status } = event as Record<string, unknown>
  const errorRecord = typeof error === 'object' && error !== null ? error as Record<string, unknown> : undefined

  return {
    timestamp: toClickHouseDateTime(event.timestamp),
    level: event.level,
    service: event.service,
    environment: event.environment,
    request_id: readString(event, 'requestId') ?? '',
    trace_id: readString(event, 'traceId') ?? '',
    span_id: readString(event, 'spanId') ?? '',
    method: readString(event, 'method') ?? '',
    path: readString(event, 'path') ?? '',
    status: typeof status === 'number' ? status : null,
    duration: readString(event, 'duration') ?? '',
    duration_ms: readUInt32(durationMs),
    error_name: typeof errorRecord?.name === 'string' ? errorRecord.name : '',
    error_message: typeof errorRecord?.message === 'string' ? errorRecord.message : '',
    data: JSON.stringify(event),
  }
}

/**
 * Serialize a batch as [`JSONEachRow`](https://clickhouse.com/docs/en/interfaces/formats#jsoneachrow):
 * one JSON object per line.
 */
export function toJSONEachRow(events: WideEvent[], transform: (event: WideEvent) => Record<string, unknown> = toClickHouseRow): string {
  return events.map(event => JSON.stringify(transform(event))).join('\n')
}

/** Build the HTTP interface URL carrying the INSERT query and settings. */
export function resolveClickHouseUrl(config: ClickHouseConfig): string {
  const base = trimTrailingSlashes(config.endpoint)
  const database = config.database ?? DEFAULT_DATABASE
  const table = config.table ?? DEFAULT_TABLE
  const asyncInsert = config.asyncInsert ?? true

  const params = new URLSearchParams({
    database,
    query: `INSERT INTO ${table} FORMAT JSONEachRow`,
  })

  if (asyncInsert) {
    params.set('async_insert', '1')
    params.set('wait_for_async_insert', config.waitForAsyncInsert ? '1' : '0')
  }

  return `${base}/?${params.toString()}`
}

function buildHeaders(config: ClickHouseConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-ndjson' }
  const username = config.username ?? DEFAULT_USERNAME

  // Credentials go in headers rather than the query string so they never land
  // in ClickHouse's query_log or an intermediate proxy's access log.
  headers['X-ClickHouse-User'] = username
  if (config.password) headers['X-ClickHouse-Key'] = config.password

  return headers
}

/**
 * Encode a batch of wide events into the ClickHouse insert request. Shared by
 * {@link createClickHouseDrain} and {@link sendBatchToClickHouse}.
 */
function encodeClickHouseRequest(events: WideEvent[], config: ClickHouseConfig): HttpDrainRequest {
  return {
    url: resolveClickHouseUrl(config),
    headers: buildHeaders(config),
    body: toJSONEachRow(events, config.transform),
  }
}

/**
 * Create a drain that inserts wide events into [ClickHouse](https://clickhouse.com/docs/en/interfaces/http)
 * over the HTTP interface, in `JSONEachRow` format.
 *
 * Asynchronous inserts are on by default so ClickHouse batches server-side
 * rather than creating one part per request — the recommended shape for log
 * ingestion — and are not awaited, so draining never blocks on disk writes.
 *
 * Configuration priority (highest to lowest):
 * 1. Overrides passed to `createClickHouseDrain()`
 * 2. `runtimeConfig.evlog.clickhouse`
 * 3. `runtimeConfig.clickhouse`
 * 4. Environment variables: `CLICKHOUSE_ENDPOINT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, …
 *
 * @example
 * ```ts
 * // Local instance, default table
 * initLogger({ drain: createClickHouseDrain({ endpoint: 'http://localhost:8123' }) })
 *
 * // ClickHouse Cloud
 * initLogger({ drain: createClickHouseDrain({
 *   endpoint: 'https://abc123.eu-west-1.aws.clickhouse.cloud:8443',
 *   password: process.env.CLICKHOUSE_PASSWORD,
 *   database: 'logs',
 * }) })
 * ```
 */
export function createClickHouseDrain(overrides?: Partial<ClickHouseConfig>) {
  return defineHttpDrain<ClickHouseConfig>({
    name: 'clickhouse',
    label: 'ClickHouse',
    resolve: async () => {
      const config = await resolveAdapterConfig<ClickHouseConfig>('clickhouse', CLICKHOUSE_FIELDS, overrides)
      if (!config.endpoint) {
        console.error(`[evlog/clickhouse] Missing endpoint. Set ${formatPublicEnvKeys(['NUXT_CLICKHOUSE_ENDPOINT', 'CLICKHOUSE_ENDPOINT', 'CLICKHOUSE_URL'])} env var or pass endpoint to createClickHouseDrain()`)
        return null
      }
      return config as ClickHouseConfig
    },
    encode: encodeClickHouseRequest,
  })
}

/**
 * Insert a single wide event into ClickHouse.
 */
export async function sendToClickHouse(event: WideEvent, config: ClickHouseConfig): Promise<void> {
  await sendBatchToClickHouse([event], config)
}

/**
 * Insert a batch of wide events into ClickHouse in one request.
 */
export async function sendBatchToClickHouse(events: WideEvent[], config: ClickHouseConfig): Promise<void> {
  if (events.length === 0) return
  await sendEncodedDrainRequest(encodeClickHouseRequest(events, config), {
    label: 'ClickHouse',
    source: 'clickhouse',
    timeout: config.timeout,
    retries: config.retries,
  })
}
