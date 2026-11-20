import type { LogLevel } from 'evlog'
import { buildQuery as buildEngineQuery, parseDuration, parseWhere as parseEngineWhere, VIEWS } from '../../../../evlog/src/logs-query'
import type { LogsQuery, LogsView, Where } from '../../../../evlog/src/logs-query'
import { cliErrors } from '../errors'

export { createSelection, field, isError, matchesId, matchesWhere, parseDuration, timeOf } from '../../../../evlog/src/logs-query'
export type { LogsQuery, LogsStats, LogsView, RouteStats, Selected, Where } from '../../../../evlog/src/logs-query'

/**
 * String fields of the `evlog logs` telemetry, with the exact set of values each may take.
 * Registered on the root command without loading the reader.
 */
export const LOGS_TELEMETRY_FIELDS = {
  logsView: VIEWS,
} as const satisfies Record<string, readonly string[]>

const LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']

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

export function parseWhere(raw: string): Where {
  const where = parseEngineWhere(raw)
  if (!where) throw cliErrors.LOGS_INVALID_WHERE({ value: raw })
  return where
}

export function parseWheres(value: unknown): Where[] {
  const raws = Array.isArray(value) ? value : typeof value === 'string' && value.length > 0 ? [value] : []
  return raws.map(raw => parseWhere(String(raw)))
}

export interface LogsArgs {
  what?: string
  session?: string
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
  const where = parseWheres(args.where)

  const what = args.what?.trim()
  const view: LogsView = what === 'errors' ? 'errors' : what === 'slow' ? 'slow' : what === 'stats' ? 'stats' : what ? 'trace' : 'recent'
  return buildEngineQuery({
    view,
    id: view === 'trace' ? what : undefined,
    where,
    session: typeof args.session === 'string' && args.session.length > 0 ? args.session : undefined,
    path: typeof args.path === 'string' && args.path.length > 0 ? args.path : undefined,
    status,
    since,
    until,
    level,
    limit,
    over,
  })
}
