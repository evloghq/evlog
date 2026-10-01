import type { LogLevel, WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { resolveAdapterConfig } from '../shared/config'
import { defineDrain } from '../shared/drain'

/**
 * Configuration for the in-memory drain.
 */
export interface MemoryConfig {
  /** Named store key. Multiple drains sharing the same key share the same buffer. Default: `'default'` */
  store: string
  /** Maximum number of events to keep in the ring buffer. Oldest events are discarded when the limit is exceeded. Default: `1000` */
  maxEvents: number
}

const DEFAULT_STORE = 'default'
const DEFAULT_MAX_EVENTS = 1000

const MEMORY_FIELDS: ConfigField<Partial<MemoryConfig>>[] = [
  { key: 'store', env: ['NUXT_EVLOG_MEMORY_STORE', 'EVLOG_MEMORY_STORE'] },
  { key: 'maxEvents', env: ['NUXT_EVLOG_MEMORY_MAX_EVENTS', 'EVLOG_MEMORY_MAX_EVENTS'] },
]

const stores = new Map<string, WideEvent[]>()

function getOrCreateStore(name: string): WideEvent[] {
  if (!stores.has(name)) stores.set(name, [])
  return stores.get(name)!
}

function parseMaxEvents(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.floor(value)
    return n > 0 ? n : undefined
  }
  if (typeof value === 'string' && value) {
    const parsed = Number.parseFloat(value)
    if (!Number.isFinite(parsed)) return undefined
    const n = Math.floor(parsed)
    return n > 0 ? n : undefined
  }
  return undefined
}

function resolveMemoryConfig(overrides?: Partial<MemoryConfig>): MemoryConfig {
  return {
    store: overrides?.store ?? DEFAULT_STORE,
    maxEvents: parseMaxEvents(overrides?.maxEvents) ?? DEFAULT_MAX_EVENTS,
  }
}

/**
 * Write events directly into the named store. Exported for direct use and
 * easier testing without going through the drain pipeline.
 */
export function writeToMemory(events: WideEvent[], config: MemoryConfig): void {
  if (events.length === 0) return
  const store = getOrCreateStore(config.store)
  store.push(...events)
  if (store.length > config.maxEvents) {
    store.splice(0, store.length - config.maxEvents)
  }
}

/**
 * Create a drain that stores wide events in an in-memory ring buffer.
 *
 * Works in **any** runtime — including Cloudflare Workers (workerd) — where
 * the filesystem (`evlog/fs`) is not available. Pair it with a dev-only HTTP
 * endpoint to let agents retrieve the buffer over HTTP.
 *
 * Configuration priority (highest to lowest):
 * 1. Overrides passed to `createMemoryDrain()`
 * 2. `runtimeConfig.evlog.memory` / `runtimeConfig.memory` (Nitro)
 * 3. Environment variables: `EVLOG_MEMORY_STORE`, `EVLOG_MEMORY_MAX_EVENTS`
 *
 * @example
 * ```ts
 * // Hono + Cloudflare Workers
 * import { createMemoryDrain, readMemoryLogs } from 'evlog/memory'
 *
 * app.use(evlog({ drain: createMemoryDrain() }))
 *
 * // Dev-only endpoint for agent retrieval
 * if (env.NODE_ENV === 'development') {
 *   app.get('/_evlog/logs', (c) => c.json(readMemoryLogs()))
 * }
 * ```
 */
export function createMemoryDrain(overrides?: Partial<MemoryConfig>) {
  return defineDrain<MemoryConfig>({
    name: 'memory',
    resolve: async () => {
      const resolved = await resolveAdapterConfig<Partial<MemoryConfig>>('memory', MEMORY_FIELDS, overrides)
      return resolveMemoryConfig(resolved)
    },
    send: (events, cfg) => Promise.resolve(writeToMemory(events, cfg)),
  })
}

/** Options accepted by {@link readMemoryLogs}. */
export interface ReadMemoryLogsOptions {
  /** Named store to read from. Default: `'default'` */
  store?: string
  /** Only include events with `timestamp >= since`. */
  since?: Date | string
  /** Only include events with `timestamp <= until`. */
  until?: Date | string
  /** Filter by log level. */
  level?: LogLevel | LogLevel[]
  /** Custom predicate — return `false` to skip the event. */
  filter?: (event: WideEvent) => boolean
  /** Return at most this many of the most-recent matching events. */
  limit?: number
}

function normalizeTimestamp(value: Date | string | undefined): number | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  const ts = date.getTime()
  return Number.isNaN(ts) ? undefined : ts
}

/**
 * Read events from the named in-memory store. Returns a snapshot of the
 * buffer with optional filtering, ordered oldest-first.
 *
 * @example
 * ```ts
 * import { readMemoryLogs } from 'evlog/memory'
 *
 * // All events
 * const events = readMemoryLogs()
 *
 * // Errors in the last hour
 * const errors = readMemoryLogs({
 *   level: 'error',
 *   since: new Date(Date.now() - 60 * 60 * 1000),
 * })
 *
 * // Expose as a JSON endpoint
 * app.get('/_evlog/logs', (c) => c.json(readMemoryLogs({ limit: 200 })))
 * ```
 */
export function readMemoryLogs(options: ReadMemoryLogsOptions = {}): WideEvent[] {
  const storeName = options.store ?? DEFAULT_STORE
  const events = [...(stores.get(storeName) ?? [])]

  const sinceMs = normalizeTimestamp(options.since)
  const untilMs = normalizeTimestamp(options.until)
  const levels = options.level
    ? new Set<LogLevel>(Array.isArray(options.level) ? options.level : [options.level])
    : undefined
  const custom = options.filter

  const filtered = events.filter((event) => {
    if (levels && !levels.has(event.level)) return false
    if (sinceMs !== undefined || untilMs !== undefined) {
      const ts = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : Number.NaN
      if (Number.isNaN(ts)) return false
      if (sinceMs !== undefined && ts < sinceMs) return false
      if (untilMs !== undefined && ts > untilMs) return false
    }
    if (custom && !custom(event)) return false
    return true
  })

  if (options.limit !== undefined) {
    if (options.limit <= 0) return []
    if (filtered.length > options.limit) return filtered.slice(-options.limit)
  }
  return filtered
}

/**
 * Clear all events from a named store (or `'default'`).
 *
 * @example
 * ```ts
 * clearMemoryLogs()           // clears the default store
 * clearMemoryLogs('my-store') // clears a named store
 * ```
 */
export function clearMemoryLogs(store = DEFAULT_STORE): void {
  const s = stores.get(store)
  if (s) s.length = 0
}

const VALID_LEVELS = new Set<LogLevel>(['info', 'error', 'warn', 'debug', 'fatal', 'trace'])

/**
 * Parse a flat query-string object (e.g. from `c.req.query()` in Hono, or
 * `req.query` in Express) into {@link ReadMemoryLogsOptions} with proper type
 * coercion.
 *
 * This lets agents discover and pass filter parameters through HTTP query
 * strings directly:
 *
 * @example
 * ```ts
 * // Hono — zero glue
 * app.get('/_evlog/logs', (c) =>
 *   c.json(readMemoryLogs(parseReadMemoryLogsQuery(c.req.query()))))
 *
 * // Express
 * app.get('/_evlog/logs', (req, res) =>
 *   res.json(readMemoryLogs(parseReadMemoryLogsQuery(req.query as Record<string, string>))))
 * ```
 *
 * Supported query params: `store`, `since`, `until`, `level` (comma-separated),
 * `limit`. The `filter` predicate cannot be expressed as a query param.
 */
export function parseReadMemoryLogsQuery(
  query: Record<string, string | string[] | undefined>,
): ReadMemoryLogsOptions {
  const opts: ReadMemoryLogsOptions = {}
  const { store, since, until, level, limit } = query

  if (typeof store === 'string' && store) opts.store = store
  if (typeof since === 'string' && since) opts.since = since
  if (typeof until === 'string' && until) opts.until = until

  if (level !== undefined) {
    const raw = Array.isArray(level) ? level : level.split(',')
    const levels = raw.map((l) => l.trim()).filter((l): l is LogLevel => VALID_LEVELS.has(l as LogLevel))
    if (levels.length === 1) [opts.level] = levels
    else if (levels.length > 1) opts.level = levels
  }

  if (typeof limit === 'string') {
    const n = Number.parseInt(limit, 10)
    if (!Number.isNaN(n)) opts.limit = n
  }

  return opts
}
