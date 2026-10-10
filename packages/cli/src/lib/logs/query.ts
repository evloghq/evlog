import type { LogLevel, WideEvent } from 'evlog'
import { cliErrors } from '../errors'

/** What the run shows: the latest events, the failures, the slowest, or one request. */
const VIEWS = ['recent', 'errors', 'slow', 'trace', 'stats'] as const
export type LogsView = typeof VIEWS[number]

/**
 * String fields of the `evlog logs` telemetry, with the exact set of values each may take.
 * Registered on the root command without loading the reader.
 */
export const LOGS_TELEMETRY_FIELDS = {
  logsView: VIEWS,
} as const satisfies Record<string, readonly string[]>

const LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']

const DURATION_UNITS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** `500ms`, `1.5s`, `15m`, `2h`, `3d`; a bare number is milliseconds. */
export function parseDuration(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(value.trim())
  if (!match) return undefined
  return Number(match[1]) * DURATION_UNITS[match[2] ?? 'ms']!
}

/**
 * `--since` and `--until` take a duration back from now (`15m`) or a date
 * (`2026-10-01`, `2026-10-01T09:00`). `now` is a parameter so a test does not
 * depend on the clock.
 */
export function parseTime(flag: 'since' | 'until', value: unknown, now: Date): Date | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const ago = parseDuration(value)
  if (ago !== undefined) return new Date(now.getTime() - ago)
  const at = Date.parse(value)
  if (Number.isNaN(at)) throw cliErrors.LOGS_INVALID_TIME({ flag, value })
  return new Date(at)
}

export function parseLevels(value: unknown): LogLevel[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const levels = value.split(',').map(level => level.trim())
  for (const level of levels) {
    if (!(LEVELS as readonly string[]).includes(level)) throw cliErrors.LOGS_INVALID_LEVEL({ value: level })
  }
  return levels as LogLevel[]
}

/** `500` matches that status; `5xx` the whole class. */
export function parseStatus(value: unknown): ((status: number) => boolean) | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const clazz = /^([1-5])xx$/i.exec(value)
  if (clazz) {
    const hundreds = Number(clazz[1])
    return status => Math.floor(status / 100) === hundreds
  }
  const exact = Number(value)
  if (!Number.isInteger(exact) || exact < 100 || exact > 599) throw cliErrors.LOGS_INVALID_STATUS({ value })
  return status => status === exact
}

export function parseOver(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const ms = parseDuration(value)
  if (ms === undefined) throw cliErrors.LOGS_INVALID_DURATION({ flag: 'over', value })
  return ms
}

const DEFAULT_LIMIT = 50

export function parseLimit(value: unknown, fallback = DEFAULT_LIMIT): number {
  if (typeof value !== 'string' || value.length === 0) return fallback
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1) throw cliErrors.LOGS_INVALID_LIMIT({ value })
  return limit
}

/** One `--where` clause: a dotted field, an operator, and the value it is held against. */
export interface Where {
  path: string[]
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | '~' | 'exists' | 'absent'
  value: string | number | boolean | RegExp | undefined
}

const WHERE = /^(!?)([\w.$-]+)(?:(>=|<=|!=|=|>|<|~)(.*))?$/s

function coerce(raw: string): string | number | boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  const number = Number(raw)
  return raw.trim() !== '' && !Number.isNaN(number) ? number : raw
}

/**
 * `payment.amount>5000`, `audit.outcome=failure`, `error.message~declined`,
 * `user.id`, `!error`. A quoted value keeps its quotes off: `path="/a b"`.
 */
export function parseWhere(raw: string): Where {
  const match = WHERE.exec(raw.trim())
  if (!match) throw cliErrors.LOGS_INVALID_WHERE({ value: raw })
  const [, negated, key, op, value] = match
  const path = key!.split('.')
  if (op === undefined) return { path, op: negated ? 'absent' : 'exists', value: undefined }
  if (negated) throw cliErrors.LOGS_INVALID_WHERE({ value: raw })
  if (/^[=<>~!]/.test(value!)) throw cliErrors.LOGS_INVALID_WHERE({ value: raw })
  const text = value!.replace(/^(["'])(.*)\1$/s, '$2')
  if (op === '~') {
    try {
      return { path, op, value: new RegExp(text, 'i') }
    } catch {
      throw cliErrors.LOGS_INVALID_WHERE({ value: raw })
    }
  }
  return { path, op: op as Where['op'], value: coerce(text) }
}

export function parseWheres(value: unknown): Where[] {
  const raws = Array.isArray(value) ? value : typeof value === 'string' && value.length > 0 ? [value] : []
  return raws.map(raw => parseWhere(String(raw)))
}

function read(event: WideEvent, path: string[]): unknown {
  let current: unknown = event
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export function matchesWhere(event: WideEvent, where: Where): boolean {
  const actual = read(event, where.path)
  if (where.op === 'exists') return actual !== undefined && actual !== null
  if (where.op === 'absent') return actual === undefined || actual === null
  if (actual === undefined || actual === null) return false
  if (where.op === '~') return where.value instanceof RegExp && where.value.test(typeof actual === 'string' ? actual : JSON.stringify(actual))
  const expected = where.value
  /* A numeric field does not always arrive as a number — a header, an env var
     or a hand-written payload carries it as text, and `"10000" > "5000"` is
     false lexicographically. Against a numeric clause, read it as the number
     it is rather than silently answering the wrong question. */
  const number = typeof actual === 'number'
    ? actual
    : typeof actual === 'string' && actual.trim() !== '' ? Number(actual) : Number.NaN
  if (typeof expected === 'number' && !Number.isNaN(number)) {
    switch (where.op) {
      case '=': return number === expected
      case '!=': return number !== expected
      case '>': return number > expected
      case '>=': return number >= expected
      case '<': return number < expected
      case '<=': return number <= expected
    }
  }
  const left = typeof actual === 'object' ? JSON.stringify(actual) : String(actual)
  const right = String(expected)
  switch (where.op) {
    case '=': return left === right
    case '!=': return left !== right
    case '>': return left > right
    case '>=': return left >= right
    case '<': return left < right
    case '<=': return left <= right
  }
  return false
}

export interface LogsQuery {
  view: LogsView
  where: Where[]
  /** The request or trace id a `trace` view looks for. */
  id?: string
  since?: Date
  until?: Date
  level?: LogLevel[]
  limit: number
  /** Lower bound on `durationMs` for the `slow` view. */
  over: number
  /** Every filter the flags asked for, as one predicate for the reader. */
  filter: (event: WideEvent) => boolean
}

export interface LogsArgs {
  what?: string
  since?: string
  until?: string
  level?: string
  path?: string
  status?: string
  over?: string
  limit?: string
  where?: string | string[]
}

const DEFAULT_OVER = 500

export function field(event: WideEvent, key: string): unknown {
  return (event as Record<string, unknown>)[key]
}

function text(event: WideEvent, key: string): string | undefined {
  const value = field(event, key)
  return typeof value === 'string' ? value : undefined
}

function number(event: WideEvent, key: string): number | undefined {
  const value = field(event, key)
  return typeof value === 'number' ? value : undefined
}

/** A failure by any of the three signals an event can carry: level, status, an error block. */
export function isError(event: WideEvent): boolean {
  if (event.level === 'error' || event.level === 'fatal') return true
  const status = number(event, 'status')
  if (status !== undefined && status >= 500) return true
  const error = field(event, 'error')
  return typeof error === 'object' && error !== null
}

const ID_FIELDS = ['requestId', 'traceId', 'spanId', '_parentRequestId'] as const

/**
 * Whether the event belongs to the request: an exact id, or a prefix of at
 * least eight characters, so the first block of a UUID is enough to type.
 */
export function matchesId(event: WideEvent, id: string): boolean {
  return ID_FIELDS.some((key) => {
    const value = text(event, key)
    if (!value) return false
    return value === id || (id.length >= 8 && value.startsWith(id))
  })
}

/**
 * Turn the flags into a query. Validation happens here, before any file is read.
 * `defaultLimit` is what `--limit` falls back to, from `logs.limit` in evlog.config.
 */
export function buildQuery(args: LogsArgs, now = new Date(), defaultLimit?: number): LogsQuery {
  const since = parseTime('since', args.since, now)
  const until = parseTime('until', args.until, now)
  const level = parseLevels(args.level)
  const status = parseStatus(args.status)
  const over = parseOver(args.over) ?? DEFAULT_OVER
  const limit = parseLimit(args.limit, defaultLimit)
  const path = typeof args.path === 'string' && args.path.length > 0 ? args.path : undefined
  const where = parseWheres(args.where)

  const what = args.what?.trim()
  const view: LogsView = what === 'errors' ? 'errors' : what === 'slow' ? 'slow' : what === 'stats' ? 'stats' : what ? 'trace' : 'recent'
  const id = view === 'trace' ? what : undefined

  const filter = (event: WideEvent): boolean => {
    if (path !== undefined && text(event, 'path') !== path) return false
    if (status !== undefined) {
      const value = number(event, 'status')
      if (value === undefined || !status(value)) return false
    }
    if (view === 'errors' && !isError(event)) return false
    if (view === 'slow' && (number(event, 'durationMs') ?? -1) < over) return false
    if (id !== undefined && !matchesId(event, id)) return false
    return where.every(clause => matchesWhere(event, clause))
  }

  return { view, id, where, since, until, level, limit, over, filter }
}

/**
 * The events a one-shot run shows, from everything the reader yielded in
 * file order: the last `limit` of them, oldest first, so the newest is at the
 * bottom like `tail`. The `slow` view is the exception: worst first.
 */
export function select(events: WideEvent[], query: LogsQuery): WideEvent[] {
  if (query.view === 'stats') return []
  if (query.view === 'slow') {
    return [...events]
      .sort((a, b) => (number(b, 'durationMs') ?? 0) - (number(a, 'durationMs') ?? 0))
      .slice(0, query.limit)
  }
  return events.slice(-query.limit)
}

export interface RouteStats {
  route: string
  count: number
  errors: number
  p50: number | undefined
  p95: number | undefined
}

export interface LogsStats {
  total: number
  errors: number
  byRoute: RouteStats[]
  byStatus: Record<string, number>
  byLevel: Record<string, number>
}

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
}

/** The shape of the traffic: per route, per status class, per level. Routes with the most errors first, then the busiest. */
export function computeStats(events: WideEvent[]): LogsStats {
  const routes = new Map<string, { count: number, errors: number, durations: number[] }>()
  const byStatus: Record<string, number> = {}
  const byLevel: Record<string, number> = {}
  let errors = 0
  for (const event of events) {
    const method = text(event, 'method')
    const route = `${method ? `${method} ` : ''}${text(event, 'path') ?? text(event, 'operation') ?? event.service}`
    const entry = routes.get(route) ?? { count: 0, errors: 0, durations: [] }
    entry.count += 1
    const failed = isError(event)
    if (failed) {
      entry.errors += 1
      errors += 1
    }
    const duration = number(event, 'durationMs')
    if (duration !== undefined) entry.durations.push(duration)
    routes.set(route, entry)
    const status = number(event, 'status')
    const statusKey = status === undefined ? 'none' : `${Math.floor(status / 100)}xx`
    byStatus[statusKey] = (byStatus[statusKey] ?? 0) + 1
    byLevel[event.level] = (byLevel[event.level] ?? 0) + 1
  }
  const byRoute = [...routes.entries()]
    .map(([route, entry]) => {
      const sorted = [...entry.durations].sort((a, b) => a - b)
      return { route, count: entry.count, errors: entry.errors, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }
    })
    .sort((a, b) => b.errors - a.errors || b.count - a.count || a.route.localeCompare(b.route))
  return { total: events.length, errors, byRoute, byStatus, byLevel }
}
