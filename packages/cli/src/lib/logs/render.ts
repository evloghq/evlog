import type { WideEvent } from 'evlog'
import type { CliContext } from '../../core/context'
import { createStyle } from '../../core/output'
import type { Style, StyleCode } from '../../core/output'
import { computeStats, field, isError } from './query'
import type { LogsQuery, LogsStats } from './query'

/** Fields every request event carries, shown in the fixed columns rather than the summary. */
const STANDARD = new Set([
  'timestamp', 'level', 'service', 'environment', 'version', 'commitHash', 'region',
  'duration', 'durationMs', 'method', 'path', 'status', 'requestId', 'traceId', 'spanId',
  '_parentRequestId', 'operation', 'requestLogs', 'userAgent', 'source', 'error', 'audit',
])

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function clock(timestamp: string): string {
  const at = new Date(timestamp)
  if (Number.isNaN(at.getTime())) return '--:--:--'
  return at.toTimeString().slice(0, 8)
}

function statusColor(status: number | undefined, level: string): StyleCode {
  if (level === 'error' || level === 'fatal' || (status !== undefined && status >= 500)) return 'red'
  if (level === 'warn' || (status !== undefined && status >= 400)) return 'yellow'
  return 'green'
}

/** `{ a: 1, b: { c: 2 } }` → `a=1 b{…}`; the business fields, as much as fits in a line. */
function fields(event: WideEvent, max = 3): string {
  const out: string[] = []
  for (const [key, value] of Object.entries(event)) {
    if (STANDARD.has(key) || value === undefined || value === null) continue
    if (typeof value === 'object') {
      const inner = obj(value)
      const scalar = inner && Object.entries(inner).find(([, v]) => typeof v !== 'object')
      out.push(scalar ? `${key}.${scalar[0]}=${String(scalar[1])}` : `${key}{…}`)
    } else {
      out.push(`${key}=${String(value)}`)
    }
    if (out.length === max) break
  }
  return out.join(' ')
}

/** The one thing to know about the event: the error, the audit record, or the business fields. */
function summary(event: WideEvent): { text: string, color?: StyleCode } {
  const error = obj(field(event, 'error'))
  if (error) {
    const data = obj(error.data)
    const name = str(error.code) ?? str(data?.code) ?? str(error.name) ?? 'error'
    const why = str(data?.why) ?? str(error.why)
    return { text: `✗ ${name}: ${str(error.message) ?? ''}${why ? ` · ${why}` : ''}`, color: 'red' }
  }
  const audit = obj(event.audit)
  if (audit) {
    const actor = obj(audit.actor)
    const target = obj(audit.target)
    const who = actor ? `${str(actor.type) ?? ''}:${str(actor.id) ?? ''}` : ''
    const what = target ? ` → ${str(target.type) ?? ''}:${str(target.id) ?? ''}` : ''
    return { text: `audit ${str(audit.action) ?? ''} ${who}${what} ${str(audit.outcome) ?? ''}`.trim(), color: 'magenta' }
  }
  return { text: fields(event) }
}

/** The app an event came from when several directories are read, kept off the event itself. */
export const SOURCE = Symbol('evlog.source')
export type Sourced = WideEvent & { [SOURCE]?: string }

/** One event on one line: time, request, status, duration, and what mattered. */
export function formatLine(style: Style, event: Sourced): string {
  const status = typeof field(event, 'status') === 'number' ? field(event, 'status') as number : undefined
  const method = str(field(event, 'method'))
  const path = str(field(event, 'path')) ?? str(field(event, 'operation')) ?? event.service
  const where = method ? `${method.padEnd(6)} ${path}` : `       ${path}`
  const { text, color } = summary(event)
  const source = event[SOURCE]
  const columns = [
    style.paint('dim', clock(event.timestamp)),
    ...(source ? [style.paint('cyan', source.padEnd(12))] : []),
    where.padEnd(44),
    style.paint(statusColor(status, event.level), status !== undefined ? String(status) : event.level.padEnd(3)),
    style.paint('dim', (event.duration ?? '').padStart(7)),
    color ? style.paint(color, text) : text,
  ]
  return columns.join('  ').trimEnd()
}

function section(style: Style, title: string, rows: Array<[string, string | undefined]>): string[] {
  const kept = rows.filter((row): row is [string, string] => row[1] !== undefined && row[1] !== '')
  if (kept.length === 0) return []
  const width = Math.max(...kept.map(([key]) => key.length))
  return [style.paint('dim', title.toUpperCase()), ...kept.map(([key, value]) => `  ${key.padEnd(width)}  ${value}`), '']
}

/** The whole event, grouped by what a reader looks for first, then the rest as JSON. */
export function formatEvent(style: Style, event: WideEvent): string {
  const lines: string[] = [formatLine(style, event), '']
  const error = obj(field(event, 'error'))
  const data = error ? obj(error.data) : undefined
  const audit = obj(event.audit)
  const actor = audit ? obj(audit.actor) : undefined
  const target = audit ? obj(audit.target) : undefined

  lines.push(...section(style, 'request', [
    ['requestId', str(field(event, 'requestId'))],
    ['traceId', str(field(event, 'traceId'))],
    ['parent', str(field(event, '_parentRequestId'))],
    ['service', `${event.service} · ${event.environment}${event.version ? ` · ${event.version}` : ''}`],
    ['at', event.timestamp],
  ]))
  if (error) {
    const stack = str(error.stack)?.split('\n').slice(1, 4).map(line => line.trim()).join('\n' + ' '.repeat(9))
    lines.push(...section(style, 'error', [
      ['name', str(error.name)],
      ['message', str(error.message)],
      ['status', error.statusCode !== undefined ? String(error.statusCode) : undefined],
      ['code', str(error.code) ?? str(data?.code)],
      ['why', str(data?.why) ?? str(error.why)],
      ['fix', str(data?.fix) ?? str(error.fix)],
      ['link', str(data?.link) ?? str(error.link)],
      ['stack', stack],
    ]))
  }
  if (audit) {
    lines.push(...section(style, 'audit', [
      ['action', str(audit.action)],
      ['actor', actor ? `${str(actor.type) ?? ''}:${str(actor.id) ?? ''}` : undefined],
      ['target', target ? `${str(target.type) ?? ''}:${str(target.id) ?? ''}` : undefined],
      ['outcome', str(audit.outcome)],
      ['reason', str(audit.reason)],
    ]))
  }
  const rest = Object.fromEntries(Object.entries(event).filter(([key]) => !STANDARD.has(key)))
  if (Object.keys(rest).length > 0) {
    lines.push(style.paint('dim', 'FIELDS'), ...JSON.stringify(rest, null, 2).split('\n').map(line => `  ${line}`))
  }
  return lines.join('\n').trimEnd()
}

export interface LogsResult {
  /** Where the events came from: a directory per line, or the URL. */
  sources: string[]
  query: LogsQuery
  /** Every event that matched, in the reader's order. */
  matched: number
  /** The events shown: `select()` applied to `matched`. */
  events: Sourced[]
  /** Every matched event, for `stats`. */
  all: Sourced[]
}

function describe(query: LogsQuery): string {
  const parts: string[] = []
  if (query.view === 'errors') parts.push('errors')
  if (query.view === 'slow') parts.push(`slower than ${query.over}ms`)
  if (query.view === 'trace') parts.push(`request ${query.id}`)
  for (const clause of query.where) parts.push(`${clause.path.join('.')}${clause.op === 'exists' ? '' : clause.op === 'absent' ? ' absent' : `${clause.op}${String(clause.value)}`}`)
  if (query.since) parts.push(`since ${query.since.toISOString()}`)
  if (query.until) parts.push(`until ${query.until.toISOString()}`)
  if (query.level) parts.push(`level ${query.level.join(',')}`)
  return parts.join(' · ')
}

function formatStats(style: Style, stats: LogsStats): string[] {
  const lines: string[] = []
  const ms = (value: number | undefined): string => (value === undefined ? '–' : `${value}ms`)
  const width = Math.max(5, ...stats.byRoute.map(row => row.route.length))
  lines.push(style.paint('dim', `${'ROUTE'.padEnd(width)}  ${'COUNT'.padStart(5)}  ${'ERRORS'.padStart(6)}  ${'P50'.padStart(7)}  ${'P95'.padStart(7)}`))
  for (const row of stats.byRoute) {
    const errors = row.errors > 0 ? style.paint('red', String(row.errors).padStart(6)) : String(row.errors).padStart(6)
    lines.push(`${row.route.padEnd(width)}  ${String(row.count).padStart(5)}  ${errors}  ${ms(row.p50).padStart(7)}  ${ms(row.p95).padStart(7)}`)
  }
  const classes = Object.entries(stats.byStatus).sort().map(([key, count]) => `${key} ${count}`).join(' · ')
  const levels = Object.entries(stats.byLevel).sort((a, b) => b[1] - a[1]).map(([key, count]) => `${key} ${count}`).join(' · ')
  lines.push('', `${style.paint('dim', 'status')}  ${classes}`, `${style.paint('dim', 'level ')}  ${levels}`)
  return lines
}

/** The one-shot report: a header, one line per event (or the full event for a trace), and what to try next. */
export function formatLogsReport(ctx: CliContext, result: LogsResult): string {
  const style = createStyle(ctx)
  const { query, events, matched } = result
  const lines: string[] = []
  const filters = describe(query)
  const where = result.sources.length === 1 ? result.sources[0] : `${result.sources.length} apps`
  if (query.view === 'stats') {
    lines.push(style.paint('dim', `${matched} event${matched === 1 ? '' : 's'} · ${where}${filters ? ` · ${filters}` : ''}`), '')
    if (matched === 0) return [...lines, 'no event matches'].join('\n')
    return [...lines, ...formatStats(style, computeStats(result.all))].join('\n')
  }
  const shown = events.length === matched ? `${matched} event${matched === 1 ? '' : 's'}` : `${events.length} of ${matched} events`
  lines.push(style.paint('dim', `${shown} · ${where}${filters ? ` · ${filters}` : ''}`), '')

  if (events.length === 0) {
    lines.push(query.view === 'trace' ? `no event carries the id ${query.id}` : 'no event matches')
    lines.push('', style.paint('dim', 'the fs drain writes on every request · evlog logs -f follows new events'))
    return lines.join('\n')
  }

  if (query.view === 'trace') {
    for (const event of events) lines.push(formatEvent(style, event), '')
    return lines.join('\n').trimEnd()
  }

  for (const event of events) lines.push(formatLine(style, event))
  const failures = events.filter(isError).length
  const hints: string[] = []
  if (query.view === 'recent' && failures > 0) hints.push(`evlog logs errors — the ${failures} that failed`)
  hints.push('evlog logs <requestId> — one request in full')
  if (query.view !== 'slow') hints.push('evlog logs slow — worst first')
  if (query.view === 'recent') hints.push('evlog logs stats — by route')
  lines.push('', style.paint('dim', hints.join(' · ')))
  return lines.join('\n')
}
