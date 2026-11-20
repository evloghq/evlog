import type { LogLevel, WideEvent } from 'evlog'

/*
 * The query engine behind `evlog logs`, shared with the integrations that
 * read logs back. Internal: not a package export; consumers bundle it from source.
 */

/** What the run shows: the latest events, the failures, the slowest, one request, the counts, or one summary per AI session. */
export const VIEWS = ['recent', 'errors', 'slow', 'trace', 'stats', 'sessions'] as const
export type LogsView = typeof VIEWS[number]

const DURATION_UNITS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** `500ms`, `1.5s`, `15m`, `2h`, `3d`; a bare number is milliseconds. */
export function parseDuration(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(value.trim())
  if (!match) return undefined
  return Number(match[1]) * DURATION_UNITS[match[2] ?? 'ms']!
}

/**
 * `500` matches that status; `5xx` the whole class. `undefined` for a value
 * that is neither; the caller reports it.
 */
export function parseStatus(value: string): ((status: number) => boolean) | undefined {
  const clazz = /^([1-5])xx$/i.exec(value)
  if (clazz) {
    const hundreds = Number(clazz[1])
    return status => Math.floor(status / 100) === hundreds
  }
  const exact = Number(value)
  if (!Number.isInteger(exact) || exact < 100 || exact > 599) return undefined
  return status => status === exact
}

/** One `where` clause: a dotted field, an operator, and the value it is held against. */
export interface Where {
  path: string[]
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | '~' | 'exists' | 'absent'
  value: string | number | boolean | RegExp | undefined
}

const WHERE = /^(!?)([\w.$-]+)(?:(>=|<=|!=|=|>|<|~)(.*))?$/s

/**
 * The number a piece of text spells exactly. Leading zeros, an exponent, or
 * more digits than a double holds make it an id, a code or a label, and those
 * compare as text.
 */
function exactNumber(text: string): number | undefined {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return undefined
  const number = Number(text)
  return text.includes('.') || Number.isSafeInteger(number) ? number : undefined
}

function coerce(raw: string): string | number | boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return exactNumber(raw) ?? raw
}

/**
 * `payment.amount>5000`, `audit.outcome=failure`, `error.message~declined`,
 * `user.id`, `!error`. A quoted value keeps its quotes off: `path="/a b"`.
 * `undefined` for a clause that does not parse; the caller reports it.
 */
export function parseWhere(raw: string): Where | undefined {
  const match = WHERE.exec(raw.trim())
  if (!match) return undefined
  const [, negated, key, op, value] = match
  const path = key!.split('.')
  if (op === undefined) return { path, op: negated ? 'absent' : 'exists', value: undefined }
  if (negated) return undefined
  if (/^[=<>~!]/.test(value!)) return undefined
  const text = value!.replace(/^(["'])(.*)\1$/s, '$2')
  if (op === '~') {
    try {
      return { path, op, value: new RegExp(text, 'i') }
    } catch {
      return undefined
    }
  }
  return { path, op: op as Where['op'], value: coerce(text) }
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
     it is rather than silently answering the wrong question. Text that is not
     a number has no order against one: `"n/a" > 5000` is false both ways. */
  if (typeof expected === 'number') {
    const number = typeof actual === 'number' ? actual : typeof actual === 'string' ? exactNumber(actual) : undefined
    if (number === undefined) {
      if (where.op !== '=' && where.op !== '!=') return false
    } else {
      switch (where.op) {
        case '=': return number === expected
        case '!=': return number !== expected
        case '>': return number > expected
        case '>=': return number >= expected
        case '<': return number < expected
        case '<=': return number <= expected
      }
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
  /** Every filter the query asks for, as one predicate for the reader. */
  filter: (event: WideEvent) => boolean
}

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

function record(event: WideEvent, key: string): Record<string, unknown> | undefined {
  const value = field(event, key)
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * How a request or an agent turn ended. `recovered` completed after a tool
 * call failed on the way: a 200 that is not a clean success.
 */
export type Outcome = 'completed' | 'recovered' | 'failed' | 'cancelled'

/** Tool calls of the event that failed: `eve.failedCalls`, else the failed entries of `gen_ai.tools`. */
export function failedCallsOf(event: WideEvent): number {
  const counted = record(event, 'eve')?.failedCalls
  if (typeof counted === 'number') return counted
  const tools = record(event, 'gen_ai')?.tools
  return Array.isArray(tools) ? tools.filter(tool => (tool as { success?: unknown })?.success === false).length : 0
}

/**
 * The outcome of an event. An eve turn says it in `eve.outcome`; any other
 * event is `failed` when it is an error, `cancelled` on a 499, else `completed`.
 */
export function outcomeOf(event: WideEvent): Outcome {
  const said = record(event, 'eve')?.outcome
  if (said === 'failed' || said === 'cancelled') return said
  if (said === undefined) {
    if (number(event, 'status') === 499) return 'cancelled'
    if (isError(event)) return 'failed'
  }
  return failedCallsOf(event) > 0 || (said !== undefined && isError(event)) ? 'recovered' : 'completed'
}

const ID_FIELDS = ['requestId', 'traceId', 'spanId', '_parentRequestId'] as const

/**
 * Whether the event belongs to the request: an exact id, or a prefix of at
 * least eight characters, so the first block of a UUID is enough to type.
 * A one-shot run keeps only the exact matches when there are any, see `createSelection`.
 */
export function matchesId(event: WideEvent, id: string): boolean {
  return ID_FIELDS.some((key) => {
    const value = text(event, key)
    if (!value) return false
    return value === id || (id.length >= 8 && value.startsWith(id))
  })
}

function carriesId(event: WideEvent, id: string): boolean {
  return ID_FIELDS.some(key => text(event, key) === id)
}

/** The OTel GenAI attribute that names a conversation; `session` filters on it. */
const SESSION_FIELD = ['gen_ai', 'conversation', 'id']

/** What a query filters on, validated by the caller: CLI flags, a tool's arguments. */
export interface QueryInput {
  view: LogsView
  /** The request or trace id a `trace` view looks for. */
  id?: string
  where?: Where[]
  /** One AI conversation, by `gen_ai.conversation.id`. */
  session?: string
  path?: string
  status?: (status: number) => boolean
  since?: Date
  until?: Date
  level?: LogLevel[]
  limit: number
  over: number
}

export function buildQuery(input: QueryInput): LogsQuery {
  const { view, id, path, status, over } = input
  const where = input.session === undefined
    ? input.where ?? []
    : [...input.where ?? [], { path: SESSION_FIELD, op: '=', value: input.session } satisfies Where]

  const filter = (event: WideEvent): boolean => {
    if (view === 'sessions' && typeof read(event, SESSION_FIELD) !== 'string') return false
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

  return { view, id, where, since: input.since, until: input.until, level: input.level, limit: input.limit, over, filter }
}

function keyOf(event: WideEvent): string | undefined {
  const own = field(event, 'idempotencyKey')
  if (typeof own === 'string') return own
  const audit = field(event, 'audit')
  if (typeof audit !== 'object' || audit === null) return undefined
  const key = (audit as Record<string, unknown>).idempotencyKey
  return typeof key === 'string' ? key : undefined
}

/**
 * Whether an event is new to this run. A drain can write an event twice when
 * the step that emitted it is retried; both copies carry the same
 * `idempotencyKey` (or `audit.idempotencyKey`). Events without one are always new.
 */
export function createDedupe(): (event: WideEvent) => boolean {
  const seen = new Set<string>()
  return (event) => {
    const key = keyOf(event)
    if (key === undefined) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
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

export const timeOf = (event: WideEvent): number => Date.parse(event.timestamp) || 0

/**
 * Where an event stands among the ones a run read: `seq` is the order read,
 * and `at` its timestamp when several sources are merged by time, else 0.
 */
interface Placed<T extends WideEvent = WideEvent> {
  event: T
  at: number
  seq: number
}

const inOrder = (a: Omit<Placed, 'event'>, b: Omit<Placed, 'event'>): number => a.at - b.at || a.seq - b.seq
const latestFirst = (a: Placed, b: Placed): number => inOrder(b, a)
const slowestFirst = (a: Placed, b: Placed): number =>
  (number(b.event, 'durationMs') ?? 0) - (number(a.event, 'durationMs') ?? 0) || inOrder(a, b)

/** The `limit` values that sort first, in memory that does not grow with how many are offered. */
function keepFirst<T>(limit: number, compare: (a: T, b: T) => number): { add: (value: T) => void, values: () => T[] } {
  const slack = Math.max(limit, 1024)
  const kept: T[] = []
  const trim = (): void => {
    kept.sort(compare)
    if (kept.length > limit) kept.length = limit
  }
  return {
    add(value) {
      kept.push(value)
      if (kept.length >= limit + slack) trim()
    },
    values() {
      trim()
      return kept
    },
  }
}

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
}

/** A count per key, listed in the order the keys first appear among the events. */
function createTally(): { add: (key: string, placed: Placed) => void, counts: () => Record<string, number> } {
  const keys = new Map<string, { count: number, at: number, seq: number }>()
  return {
    add(key, placed) {
      const entry = keys.get(key)
      if (!entry) keys.set(key, { count: 1, at: placed.at, seq: placed.seq })
      else {
        entry.count += 1
        if (inOrder(placed, entry) < 0) Object.assign(entry, { at: placed.at, seq: placed.seq })
      }
    },
    counts: () => Object.fromEntries([...keys].sort((a, b) => inOrder(a[1], b[1])).map(([key, entry]) => [key, entry.count])),
  }
}

/**
 * The shape of the traffic: per route, per status class, per level. Routes
 * with the most errors first, then the busiest. Of each event it keeps a
 * duration, which the percentiles need, and nothing else.
 */
function createStats(): { add: (placed: Placed) => void, result: () => LogsStats } {
  const routes = new Map<string, { count: number, errors: number, durations: number[] }>()
  const byStatus = createTally()
  const byLevel = createTally()
  let total = 0
  let errors = 0
  return {
    add(placed) {
      const { event } = placed
      total += 1
      const method = text(event, 'method')
      const route = `${method ? `${method} ` : ''}${text(event, 'path') ?? text(event, 'operation') ?? event.service}`
      const entry = routes.get(route) ?? { count: 0, errors: 0, durations: [] }
      entry.count += 1
      if (isError(event)) {
        entry.errors += 1
        errors += 1
      }
      const duration = number(event, 'durationMs')
      if (duration !== undefined) entry.durations.push(duration)
      routes.set(route, entry)
      const status = number(event, 'status')
      byStatus.add(status === undefined ? 'none' : `${Math.floor(status / 100)}xx`, placed)
      byLevel.add(event.level, placed)
    },
    result() {
      const byRoute = [...routes.entries()]
        .map(([route, entry]) => {
          const sorted = entry.durations.sort((a, b) => a - b)
          return { route, count: entry.count, errors: entry.errors, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }
        })
        .sort((a, b) => b.errors - a.errors || b.count - a.count || a.route.localeCompare(b.route))
      return { total, errors, byRoute, byStatus: byStatus.counts(), byLevel: byLevel.counts() }
    },
  }
}

/** One AI session, summed over its events by the `sessions` view. Absent fields were absent on every event. */
export interface SessionSummary {
  session: string
  /** The first turn's start (its event's timestamp minus its duration) and the last event's timestamp. */
  firstAt: string
  lastAt: string
  /** Wall clock from `firstAt` to `lastAt`, user think time included. */
  elapsedMs: number
  /** The turns' own durations summed: time spent working, not waiting. Absent when no turn has a duration. */
  processingMs?: number
  turns: number
  outcomes: Record<Outcome, number>
  /** Tool calls that failed across the session, including the ones a turn recovered from. */
  failedToolCalls: number
  modelCalls?: number
  toolCalls?: number
  /** Token counts summed over the turns that reported each one; `turnsReporting` counts the turns that reported any. */
  tokens?: { input?: number, output?: number, cacheRead?: number, cacheWrite?: number, turnsReporting: number }
  /** Provider-reported cost, summed over the turns that reported one, and how many did. */
  cost?: { usd: number, turnsReporting: number }
  models?: string[]
  slowest?: { requestId?: string, durationMs: number }
  latestFailure?: { requestId?: string, outcome: Outcome, code?: string, message?: string, failedTools?: string[] }
  lastRequestId?: string
  /** Up to five trace ids of the session's turns, newest first. */
  traceIds?: string[]
}

const MAX_TRACE_IDS = 5

function createSessions(limit: number): { add: (placed: Placed) => void, result: () => { sessions: SessionSummary[], total: number } } {
  const all = new Map<string, SessionSummary & { startMs: number, endMs: number, failureMs: number, traces: Map<string, number> }>()
  return {
    add({ event }) {
      const id = read(event, SESSION_FIELD) as string
      const end = timeOf(event)
      const duration = number(event, 'durationMs')
      const start = end - (duration ?? 0)
      let entry = all.get(id)
      if (!entry) {
        entry = { session: id, firstAt: '', lastAt: '', startMs: start, endMs: end, failureMs: -Infinity, traces: new Map(), elapsedMs: 0, turns: 0, outcomes: { completed: 0, recovered: 0, failed: 0, cancelled: 0 }, failedToolCalls: 0 }
        all.set(id, entry)
      }
      entry.startMs = Math.min(entry.startMs, start)
      const latest = end >= entry.endMs
      entry.endMs = Math.max(entry.endMs, end)
      entry.turns += 1
      const outcome = outcomeOf(event)
      entry.outcomes[outcome] += 1
      entry.failedToolCalls += failedCallsOf(event)
      const requestId = text(event, 'requestId')
      if (latest && requestId) entry.lastRequestId = requestId
      if (duration !== undefined) {
        entry.processingMs = (entry.processingMs ?? 0) + duration
        if (!entry.slowest || duration > entry.slowest.durationMs) entry.slowest = { ...(requestId && { requestId }), durationMs: duration }
      }
      const genAi = record(event, 'gen_ai')
      if (typeof genAi?.calls === 'number') entry.modelCalls = (entry.modelCalls ?? 0) + genAi.calls
      const tools = genAi?.tools
      if (Array.isArray(tools)) entry.toolCalls = (entry.toolCalls ?? 0) + tools.length
      const usage = genAi?.usage as Record<string, unknown> | undefined
      if (usage && typeof usage === 'object') {
        const counts = {
          input: usage.input_tokens,
          output: usage.output_tokens,
          cacheRead: (usage.cache_read as { input_tokens?: unknown } | undefined)?.input_tokens,
          cacheWrite: (usage.cache_write as { input_tokens?: unknown } | undefined)?.input_tokens,
        }
        const reported = Object.entries(counts).filter((pair): pair is [keyof typeof counts, number] => typeof pair[1] === 'number')
        if (reported.length > 0) {
          const tokens = entry.tokens ??= { turnsReporting: 0 }
          tokens.turnsReporting += 1
          for (const [key, count] of reported) tokens[key] = (tokens[key] ?? 0) + count
        }
        if (typeof usage.cost === 'number') {
          const cost = entry.cost ??= { usd: 0, turnsReporting: 0 }
          cost.usd = Math.round((cost.usd + usage.cost) * 1_000_000) / 1_000_000
          cost.turnsReporting += 1
        }
      }
      const request = genAi?.request as { model?: unknown, models?: unknown } | undefined
      const models = Array.isArray(request?.models) ? request.models : request?.model === undefined ? [] : [request.model]
      for (const model of models) {
        if (typeof model === 'string' && !entry.models?.includes(model)) (entry.models ??= []).push(model)
      }
      if (outcome !== 'completed' && end >= entry.failureMs) {
        entry.failureMs = end
        const error = record(event, 'error')
        const failedTools = Array.isArray(tools) ? tools.flatMap(tool => (tool as { success?: unknown, name?: unknown }).success === false && typeof (tool as { name?: unknown }).name === 'string' ? [(tool as { name: string }).name] : []) : []
        entry.latestFailure = {
          ...(requestId && { requestId }),
          outcome,
          ...(typeof error?.code === 'string' && { code: error.code }),
          ...(typeof error?.message === 'string' && { message: error.message }),
          ...(failedTools.length > 0 && { failedTools }),
        }
      }
      const traceId = text(event, 'traceId')
      if (traceId) entry.traces.set(traceId, Math.max(entry.traces.get(traceId) ?? -Infinity, end))
    },
    result() {
      const sessions = [...all.values()]
        .sort((a, b) => b.endMs - a.endMs)
        .slice(0, limit)
        .map(({ startMs, endMs, failureMs: _failureMs, traces, ...summary }) => ({
          ...summary,
          ...(traces.size > 0 && { traceIds: [...traces].sort((a, b) => b[1] - a[1]).slice(0, MAX_TRACE_IDS).map(([traceId]) => traceId) }),
          firstAt: new Date(startMs).toISOString(), lastAt: new Date(endMs).toISOString(), elapsedMs: endMs - startMs }))
      return { sessions, total: all.size }
    },
  }
}

/** What a one-shot run reports of the events it read. */
export interface Selected<T extends WideEvent = WideEvent> {
  /** How many events were offered, a repeated delivery counted once. */
  matched: number
  /**
   * The last `limit` of them, oldest first, so the newest is at the bottom like
   * `tail`. The `slow` view is the exception: worst first. Empty for `stats` and `sessions`.
   */
  events: T[]
  /** The `stats` view. */
  stats?: LogsStats
  /** The `sessions` view: the newest `limit` sessions, latest activity first. */
  sessions?: SessionSummary[]
  /** The `sessions` view: how many sessions the matched events belong to. */
  sessionsMatched?: number
}

/**
 * Takes the events of a one-shot run one at a time and keeps what the view
 * shows, so a log of any size is read in the memory `limit` events need. `stats`
 * also keeps one duration per event.
 *
 * With an id, the events carrying it whole are kept apart and win when there
 * are any: `turn_1` is a prefix of `turn_10`, and a complete id must not
 * select the requests it happens to prefix.
 *
 * Events are in the order offered. With `byTime`, for several sources read one
 * after the other, they are ordered by timestamp, and by the order offered
 * within the same instant.
 */
export function createSelection<T extends WideEvent>(query: LogsQuery, byTime = false): { add: (event: T) => void, done: () => Selected<T> } {
  const collect = () => ({
    stats: query.view === 'stats' ? createStats() : query.view === 'sessions' ? createSessions(query.limit) : undefined,
    shown: keepFirst<Placed<T>>(query.limit, query.view === 'slow' ? slowestFirst : latestFirst),
    matched: 0,
  })
  const all = collect()
  const exact = query.id === undefined ? undefined : collect()
  const isNew = createDedupe()
  let seq = 0
  return {
    add(event) {
      if (!isNew(event)) return
      const placed = { event, at: byTime ? timeOf(event) : 0, seq: seq++ }
      for (const into of exact && carriesId(event, query.id!) ? [all, exact] : [all]) {
        into.matched += 1
        if (into.stats) into.stats.add(placed)
        else into.shown.add(placed)
      }
    },
    done() {
      const from = exact && exact.matched > 0 ? exact : all
      const events = from.shown.values().map(placed => placed.event)
      const aggregate = from.stats?.result()
      if (aggregate && 'sessions' in aggregate) return { matched: from.matched, events: [], sessions: aggregate.sessions, sessionsMatched: aggregate.total }
      return { matched: from.matched, events: query.view === 'slow' ? events : events.reverse(), stats: aggregate }
    },
  }
}
