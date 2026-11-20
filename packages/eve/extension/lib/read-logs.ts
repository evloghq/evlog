import { createError } from 'evlog'
import type { LogLevel, WideEvent } from 'evlog'
import { readFsLogs } from 'evlog/fs'
import { buildQuery, createSelection, parseDuration, parseStatus, parseWhere, timeOf } from './vendor/logs-query'
import type { LogsStats, LogsView, Where } from './vendor/logs-query'
import { DEFAULT_VERCEL_CONNECTOR, readVercelLogs, requestConnectToken, VercelReadError, vercelScope } from './vendor/logs-vercel'

/** What the model asks the `logs` tool for. */
export interface LogsToolInput {
  view?: LogsView
  /** The request id a `trace` view looks for; the first block of a UUID is enough. */
  id?: string
  session?: string
  where?: string[]
  /** A duration back from now, such as `30m`, `6h` or `3d`. */
  since?: string
  /** A duration back from now: only events older than this. */
  until?: string
  level?: LogLevel[]
  path?: string
  /** `500`, or a class such as `5xx`. */
  status?: string
  /** For `slow`: the duration a turn has to exceed, such as `2s`. */
  over?: string
  /** Dotted fields to add to each row of a list view, such as `user.id`. */
  fields?: string[]
  limit?: number
}

/** Where the events are read from. */
export type LogsSource =
  | { kind: 'fs', dir: string }
  | { kind: 'vercel', oidcToken: string, connector: string, fetchFn?: typeof fetch }

/**
 * One event in a list view: enough to pick which one to open with `trace`.
 * A turn's event runs to about a thousand tokens, most of it the tool list.
 */
export interface LogsRow {
  requestId?: string
  timestamp: string
  level: string
  status?: number
  durationMs?: number
  path?: string
  session?: string
  outcome?: string
  error?: { code?: string, message?: string, why?: string, fix?: string }
  /** Tools the turn called, and the ones among them that failed. */
  toolCalls?: number
  failedTools?: string[]
  tokens?: number
  /** The fields the input asked for, by dotted name. */
  fields?: Record<string, unknown>
}

export interface LogsToolResult {
  /** What was read, such as `.evlog/logs` or `vercel prj_… (production)`. */
  source: string
  /** `session` when the caller may only read the session it is in. */
  scope: 'agent' | 'session'
  view: LogsView
  matched: number
  /** The list views: one row per event. */
  rows?: LogsRow[]
  /** The `trace` view: every event of one request, in full. */
  events?: WideEvent[]
  stats?: LogsStats
  notes?: string[]
}

const DAY_MS = 86_400_000
const VERCEL_MAX_LINES = 10_000
const DEFAULT_OVER = 500
export const DEFAULT_LIMIT = 10

function invalid(message: string, why: string, fix: string): never {
  throw createError({ message, status: 400, why, fix })
}

function ago(name: 'since' | 'until' | 'over', value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  return parseDuration(value) ?? invalid(`${name} "${value}" is not a duration`, `${name} takes a duration such as 30m, 6h or 3d`, 'Pass a duration such as 30m, 6h or 3d')
}

function wheres(values: string[] | undefined): Where[] {
  return (values ?? []).map(raw => parseWhere(raw) ?? invalid(`where "${raw}" cannot be read`, 'A clause is a dotted field, an operator and a value', 'Write it like user.id=42, durationMs>1000, error.message~declined, audit or !error'))
}

function at(event: WideEvent, path: string): unknown {
  let current: unknown = event
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function toRow(event: WideEvent, fields: string[]): LogsRow {
  const error = at(event, 'error')
  const tools = at(event, 'gen_ai.tools')
  const calls = Array.isArray(tools) ? tools as Array<{ name?: string, success?: boolean }> : undefined
  const failed = calls?.filter(call => call.success === false).flatMap(call => call.name ? [call.name] : [])
  const picked = Object.fromEntries(fields.map(path => [path, at(event, path)]).filter(([, value]) => value !== undefined))
  const row: LogsRow = {
    requestId: text(at(event, 'requestId')),
    timestamp: event.timestamp,
    level: event.level,
    status: number(at(event, 'status')),
    durationMs: number(at(event, 'durationMs')),
    path: text(at(event, 'path')),
    session: text(at(event, 'gen_ai.conversation.id')),
    outcome: text(at(event, 'eve.outcome')),
    toolCalls: calls?.length,
    tokens: number(at(event, 'gen_ai.usage.total_tokens')),
  }
  if (typeof error === 'object' && error !== null) {
    const { code, message, why, fix } = error as Record<string, unknown>
    row.error = { code: text(code), message: text(message), why: text(why), fix: text(fix) }
  }
  if (failed && failed.length > 0) row.failedTools = failed
  if (Object.keys(picked).length > 0) row.fields = picked
  return row
}

/**
 * Reads the agent's own events with the engine behind `evlog logs`. `session`,
 * when set, is the only session the caller may read, whatever the input asks.
 * List views return one row per event; `trace` returns the events in full.
 */
export async function readLogs(input: LogsToolInput, options: { source: LogsSource, session?: string, now?: Date }): Promise<LogsToolResult> {
  const now = options.now ?? new Date()
  const view = input.view ?? (input.id ? 'trace' : 'recent')
  const session = options.session ?? input.session
  const sinceAgo = ago('since', input.since)
  const untilAgo = ago('until', input.until)
  const status = input.status === undefined
    ? undefined
    : parseStatus(input.status) ?? invalid(`status "${input.status}" is not a status`, 'status takes one HTTP status or a class', 'Pass a status such as 500, or a class such as 5xx')
  const query = buildQuery({
    view,
    id: view === 'trace' ? input.id : undefined,
    where: wheres(input.where),
    session,
    path: input.path,
    status,
    since: sinceAgo === undefined ? undefined : new Date(now.getTime() - sinceAgo),
    until: untilAgo === undefined ? undefined : new Date(now.getTime() - untilAgo),
    level: input.level,
    limit: input.limit ?? DEFAULT_LIMIT,
    over: ago('over', input.over) ?? DEFAULT_OVER,
  })
  if (view === 'trace' && !query.id) invalid('The trace view needs an id', 'trace shows every event carrying one request id', 'Pass id, or another view')
  const selection = createSelection<WideEvent>(query, true)
  const scope = options.session === undefined ? 'agent' : 'session'
  const { source } = options
  const result = (from: string, notes: string[] = []): LogsToolResult => {
    const { matched, events, stats } = selection.done()
    return {
      source: from,
      scope,
      view,
      matched,
      ...(stats ? { stats } : view === 'trace' ? { events } : { rows: events.map(event => toRow(event, input.fields ?? [])) }),
      ...(notes.length > 0 && { notes }),
    }
  }

  if (source.kind === 'fs') {
    for await (const event of readFsLogs({ dir: source.dir, since: query.since, until: query.until, level: query.level, filter: query.filter })) selection.add(event)
    return result(source.dir)
  }

  const vercel = vercelScope(source.oidcToken)
  if (!vercel) throw createError({ message: 'The deployment\'s OIDC token names no project', status: 500, why: 'Reads are pinned to the project in the token', fix: 'Turn on OIDC federation for the project in its Vercel settings' })
  let token: string
  try {
    token = await requestConnectToken(source.oidcToken, source.connector, source.fetchFn)
  } catch (error) {
    if (!(error instanceof VercelReadError)) throw error
    throw createError({
      message: `Vercel Connect issued no token for ${source.connector} (${error.status})`,
      status: 503,
      why: 'The connector does not exist on the team, or is not attached to this project and environment',
      fix: `Run npx evlog setup vercel in the agent's project${source.connector === DEFAULT_VERCEL_CONNECTOR ? '' : `, or check logs.vercel.connector (${source.connector})`}`,
      link: 'https://evlog.dev/cli/logs',
    })
  }
  const reader = readVercelLogs({
    token,
    scope: vercel,
    since: query.since ?? new Date(now.getTime() - DAY_MS),
    until: query.until ?? now,
    search: session,
    maxLines: VERCEL_MAX_LINES,
    fetchFn: source.fetchFn,
  })
  try {
    for (let step = await reader.next(); ; step = await reader.next()) {
      if (step.done) {
        return result(`vercel ${vercel.projectId} (${vercel.environment})`, [
          ...(step.value.truncated > 0 ? [`${step.value.truncated} log line(s) were cut by Vercel's size limit and skipped`] : []),
          ...(step.value.more ? [`Only the newest ${step.value.lines} log lines were read; narrow since or pass session to reach older ones`] : []),
        ])
      }
      const event = step.value
      if (query.until && timeOf(event) > query.until.getTime()) continue
      if (query.level && !query.level.includes(event.level)) continue
      if (query.filter(event)) selection.add(event)
    }
  } catch (error) {
    if (!(error instanceof VercelReadError)) throw error
    throw createError({
      message: `Vercel refused the read (${error.status})`,
      status: 502,
      why: error.status === 403 ? 'The access token stored in the connector cannot read runtime logs' : error.message,
      fix: error.status === 403 ? `Replace the API key of ${source.connector} with a Vercel access token scoped to the team` : 'Narrow since to the plan\'s log retention (Hobby 1 hour, Pro 1 day)',
    })
  }
}
