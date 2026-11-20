import { createError } from 'evlog'
import type { LogLevel, WideEvent } from 'evlog'
import { readFsLogs } from 'evlog/fs'
import { buildQuery, createSelection, failedCallsOf, outcomeOf, parseDuration, parseStatus, parseWhere, timeOf } from './vendor/logs-query'
import type { LogsStats, LogsView, Outcome, SessionSummary, Where } from './vendor/logs-query'
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
  /** `diagnostic` adds models, model calls, cost, cache reads and trace ids to each row. */
  detail?: 'brief' | 'diagnostic'
  limit?: number
  /** For `trace`: raise the size budget so a large event comes back whole. */
  full?: boolean
  /** Refuse the read unless it is this source and environment, so a question about production is never answered from local files. */
  expect?: { source?: 'files' | 'vercel', environment?: string }
}

/** Where the events are read from. */
export type LogsSource =
  | { kind: 'fs', dir: string, /** The environment of the process that writes the files. */ environment?: string }
  | { kind: 'vercel', oidcToken: string, connector: string, fetchFn?: typeof fetch }

/** What was read, as data: which store, which project and environment. */
export interface LogsOrigin {
  kind: 'files' | 'vercel'
  /** `files`: the directory read. */
  dir?: string
  /** `vercel`: the project the deployment's OIDC token is pinned to. */
  teamId?: string
  projectId?: string
  environment: string
}

/**
 * Whether the result covers everything the query asked for. `false` when the
 * source was cut short, so an empty or short result proves nothing beyond what it read.
 */
export interface LogsCoverage {
  complete: boolean
  /** Why it is not complete. */
  reasons?: string[]
}

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
  /** eve's own outcome: completed, failed or cancelled. */
  outcome?: string
  /** `completed`, `recovered` (completed after a failed tool call), `failed` or `cancelled`. */
  result?: Outcome
  error?: { code?: string, message?: string, why?: string, fix?: string }
  /** Tools the turn called, and the ones among them that failed. */
  toolCalls?: number
  failedTools?: string[]
  tokens?: number
  /** `detail: 'diagnostic'` only, each when the event has it. */
  failedCalls?: number
  modelCalls?: number
  models?: string[]
  cacheReadTokens?: number
  /** Provider-reported, in USD. */
  cost?: number
  traceId?: string
  spanId?: string
  /** The fields the input asked for, by dotted name. */
  fields?: Record<string, unknown>
}

/** Where a turn's OTel spans are: the trace, the turn's `invoke_agent` span, and how to open it when that is known. */
export interface TraceReference {
  requestId?: string
  traceId: string
  spanId?: string
  /** A command that opens the trace, for local `eve dev` traces. */
  open?: string
}

export interface LogsToolResult {
  /** What was read, such as `.evlog/logs` or `vercel prj_… (production)`. */
  source: string
  origin: LogsOrigin
  /** `session` when the caller may only read the session it is in. */
  scope: 'agent' | 'session'
  /** The session and turn the tool was called from. */
  caller?: { session: string, turn?: string }
  view: LogsView
  /** The time range read. No `since` on files: every file in the directory. */
  window: { since?: string, until: string }
  /** The filters applied, `over` for `slow` included. */
  filters: Record<string, unknown>
  /** Events that matched; `returned` of them are in the result. */
  matched: number
  returned: number
  coverage: LogsCoverage
  /** The list views: one row per event. */
  rows?: LogsRow[]
  /** The `trace` view: full wide events of one request, not its span tree. */
  events?: WideEvent[]
  /** The `trace` view: events left out to stay within the size budget. */
  omitted?: number
  /** The `trace` view: where the events' OTel spans are. */
  traces?: TraceReference[]
  stats?: LogsStats
  /** The `sessions` view, latest first; `current` marks the caller's. */
  sessions?: Array<SessionSummary & { current?: true }>
  sessionsMatched?: number
  notes?: string[]
}

const DAY_MS = 86_400_000
const VERCEL_MAX_LINES = 10_000
const DEFAULT_OVER = 500
export const DEFAULT_LIMIT = 10
/** Characters of JSON the `trace` view returns by default, and with `full`. */
const TRACE_BUDGET = 24_000
const TRACE_BUDGET_FULL = 200_000

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

function toRow(event: WideEvent, fields: string[], diagnostic: boolean): LogsRow {
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
    result: outcomeOf(event),
    toolCalls: calls?.length,
    tokens: number(at(event, 'gen_ai.usage.total_tokens')),
  }
  if (diagnostic) {
    const failedCalls = failedCallsOf(event)
    const models = at(event, 'gen_ai.request.models')
    const model = text(at(event, 'gen_ai.request.model'))
    Object.assign(row, Object.fromEntries(Object.entries({
      failedCalls: failedCalls > 0 ? failedCalls : undefined,
      modelCalls: number(at(event, 'gen_ai.calls')),
      models: Array.isArray(models) ? models : model ? [model] : undefined,
      cacheReadTokens: number(at(event, 'gen_ai.usage.cache_read.input_tokens')),
      cost: number(at(event, 'gen_ai.usage.cost')),
      traceId: text(at(event, 'traceId')),
      spanId: text(at(event, 'spanId')),
    }).filter(([, value]) => value !== undefined)))
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
function mismatch(expected: NonNullable<LogsToolInput['expect']>, origin: LogsOrigin, source: string): void {
  const kind = expected.source !== undefined && expected.source !== origin.kind
  const environment = expected.environment !== undefined && expected.environment !== origin.environment
  if (!kind && !environment) return
  const wanted = [expected.source, expected.environment].filter(Boolean).join(', ')
  throw createError({
    message: `This tool reads ${source} (${origin.kind}, ${origin.environment}), not ${wanted}`,
    status: 409,
    why: 'The read was refused rather than answered from another source, where finding nothing would say nothing about the one asked for',
    fix: origin.kind === 'files'
      ? 'Say the question cannot be answered here: this agent reads its local files. Hosted logs are read when logs.source is vercel in the evlog mount, with the project\'s OIDC token'
      : 'Say which environment this tool reads, and answer for that one only',
  })
}

/**
 * Leaves out whole events past the budget, so the model never receives a
 * cut event it could take for the original.
 */
function withinBudget(events: WideEvent[], budget: number): { events: WideEvent[], omitted: number } {
  const kept: WideEvent[] = []
  let used = 0
  for (const event of events) {
    const size = JSON.stringify(event).length
    if (used + size > budget) break
    kept.push(event)
    used += size
  }
  return { events: kept, omitted: events.length - kept.length }
}

function traceReferences(events: WideEvent[], local: boolean): TraceReference[] {
  return events.flatMap((event) => {
    const traceId = text(at(event, 'traceId'))
    if (!traceId) return []
    const spanId = text(at(event, 'spanId'))
    const requestId = text(at(event, 'requestId'))
    return [{ ...(requestId && { requestId }), traceId, ...(spanId && { spanId }), ...(local && { open: `eve traces show ${traceId}` }) }]
  })
}

function appliedFilters(input: LogsToolInput, session: string | undefined, view: LogsView, over: number): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
    id: view === 'trace' ? input.id : undefined,
    session,
    where: input.where?.length ? input.where : undefined,
    level: input.level,
    path: input.path,
    status: input.status,
    over: view === 'slow' ? `${over}ms` : undefined,
    limit: input.limit ?? DEFAULT_LIMIT,
  }).filter(([, value]) => value !== undefined))
}

export async function readLogs(input: LogsToolInput, options: { source: LogsSource, session?: string, caller?: { session: string, turn?: string }, now?: Date }): Promise<LogsToolResult> {
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
  const filters = appliedFilters(input, session, view, query.over)
  const result = (from: string, origin: LogsOrigin, window: LogsToolResult['window'], gaps: string[] = [], notes: string[] = []): LogsToolResult => {
    const selected = selection.done()
    const { matched, stats, sessions, sessionsMatched } = selected
    let { events } = selected
    let omitted = 0
    if (view === 'trace') ({ events, omitted } = withinBudget(events, input.full ? TRACE_BUDGET_FULL : TRACE_BUDGET))
    const returned = sessions ? sessions.length : stats ? matched : events.length
    const shownNotes = [
      ...notes,
      ...(view === 'trace' ? ['trace returns full wide events, not the OTel span tree: open a span tree with traces[].traceId'] : []),
      ...(omitted > 0 ? [`${omitted} event(s) left out to stay within the size budget; pass full: true, or narrow with fields in a list view`] : []),
      ...(view === 'trace' && events.length > 0 && !events.some(event => at(event, 'traceId')) ? ['No traceId on these events: the agent does not export evlogTraces() from agent/instrumentation, or the turn was not traced'] : []),
    ]
    return {
      source: from,
      origin,
      scope,
      ...(options.caller && { caller: options.caller }),
      view,
      window,
      filters,
      matched,
      returned,
      coverage: gaps.length > 0 ? { complete: false, reasons: gaps } : { complete: true },
      ...(stats && { stats }),
      ...(sessions && { sessions: sessions.map(summary => summary.session === options.caller?.session ? { ...summary, current: true as const } : summary), sessionsMatched }),
      ...(view === 'trace' && { events, ...(omitted > 0 && { omitted }), traces: traceReferences(events, origin.kind === 'files') }),
      ...(!stats && !sessions && view !== 'trace' && { rows: events.map(event => toRow(event, input.fields ?? [], input.detail === 'diagnostic')) }),
      ...(shownNotes.length > 0 && { notes: shownNotes }),
    }
  }

  if (source.kind === 'fs') {
    const origin: LogsOrigin = { kind: 'files', dir: source.dir, environment: source.environment ?? 'development' }
    if (input.expect) mismatch(input.expect, origin, source.dir)
    for await (const event of readFsLogs({ dir: source.dir, since: query.since, until: query.until, level: query.level, filter: query.filter })) selection.add(event)
    return result(source.dir, origin, { ...(query.since && { since: query.since.toISOString() }), until: (query.until ?? now).toISOString() })
  }

  const vercel = vercelScope(source.oidcToken)
  if (!vercel) throw createError({ message: 'The deployment\'s OIDC token names no project', status: 500, why: 'Reads are pinned to the project in the token', fix: 'Turn on OIDC federation for the project in its Vercel settings' })
  const origin: LogsOrigin = { kind: 'vercel', teamId: vercel.teamId, projectId: vercel.projectId, environment: vercel.environment }
  const label = `vercel ${vercel.projectId} (${vercel.environment})`
  if (input.expect) mismatch(input.expect, origin, label)
  const since = query.since ?? new Date(now.getTime() - DAY_MS)
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
    since,
    until: query.until ?? now,
    search: session,
    maxLines: VERCEL_MAX_LINES,
    fetchFn: source.fetchFn,
  })
  try {
    for (let step = await reader.next(); ; step = await reader.next()) {
      if (step.done) {
        return result(label, origin, { since: since.toISOString(), until: (query.until ?? now).toISOString() }, [
          ...(step.value.truncated > 0 ? [`${step.value.truncated} log line(s) were cut by Vercel's size limit and skipped`] : []),
          ...(step.value.more ? [`Only the newest ${step.value.lines} log lines were read; narrow since or pass session to reach older ones`] : []),
        ], query.since ? [] : ['since defaults to 1d on Vercel; runtime logs are kept 1 hour on Hobby and 1 day on Pro'])
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
