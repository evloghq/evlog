import { existsSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { telemetry } from '@evlog/telemetry'
import { EvlogError } from 'evlog'
import type { WideEvent } from 'evlog'
import { readFsLogs, tailFsLogs } from 'evlog/fs'
import type { CliContext } from '../core/context'
import { createStyle, EXIT_FAIL, EXIT_USAGE } from '../core/output'
import { defineEvlogCommand } from '../lib/command'
import { loadCliConfig } from '../lib/config'
import { cliErrors, isUsageError } from '../lib/errors'
import { flagValues } from '../lib/flags'
import { buildQuery, createSelection, timeOf } from '../lib/logs/query'
import type { LogsArgs, LogsQuery, Selected } from '../lib/logs/query'
import { formatLine, formatLogsReport, SOURCE } from '../lib/logs/render'
import type { LogsOrigin, LogsResult, Sourced } from '../lib/logs/render'
import { findConfiguredFsDrain, findLogsSink, prettyPath, resolveProject } from '../lib/project'
import type { ProjectInfo } from '../lib/project'
import { DEFAULT_VERCEL_CONNECTOR, findVercelProject, readVercelLogs, resolveVercelAccess, VercelReadError } from '../lib/logs/vercel'
import type { VercelAccess, VercelLogsSummary, VercelProject } from '../lib/logs/vercel'

export type { LogsResult } from '../lib/logs/render'

/** One place events are read from: a directory on disk, labelled when there are several. */
export interface LogsSource {
  dir: string
  /** The app the directory belongs to, when a workspace is read as a whole. */
  name?: string
}

const WORKSPACE_PARENTS = ['apps', 'packages', 'examples', 'services']

/**
 * The log directories of every app in the workspace: `apps/<app>/.evlog/logs`
 * and the like, one level down from the root. Only directories that exist count,
 * so a workspace with one app that writes reads as that app.
 */
function workspaceSources(root: string): LogsSource[] {
  const sources: LogsSource[] = []
  for (const parent of WORKSPACE_PARENTS) {
    const base = join(root, parent)
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(base, entry.name, '.evlog', 'logs')
      if (existsSync(dir)) sources.push({ dir, name: entry.name })
    }
  }
  return sources
}

/**
 * Where the events are. `--dir` wins; otherwise the directory the project
 * already writes to, else every app of the workspace that writes, else the
 * directory the fs drain is configured for, which may not exist yet.
 */
export async function resolveLogsSources(ctx: CliContext, dir: string | undefined): Promise<LogsSource[]> {
  if (dir) return [{ dir: resolve(ctx.cwd, dir) }]
  const project: ProjectInfo = await resolveProject(ctx.cwd)
  const sink = await findLogsSink(project)
  if (sink) return [{ dir: sink.dir }]
  const apps = workspaceSources(project.root)
  if (apps.length > 0) return apps
  const configured = await findConfiguredFsDrain(project, ctx.env)
  if (configured) return [{ dir: resolve(project.packageDir, configured.dir) }]
  throw cliErrors.LOGS_NO_SINK({ cwd: ctx.cwd })
}

export interface RunLogsOptions {
  dir?: string
  /** Read a JSON array of events from this URL (the memory drain's dev endpoint) instead of files. */
  url?: string
  /** Keep reading as the app writes; resolves when `signal` aborts. */
  follow?: boolean
  signal?: AbortSignal
  /** Called for each event that arrives while following. */
  onEvent?: (event: Sourced) => void
  /** Called when following has something to say that is not an event: the endpoint went quiet, or came back. */
  onNotice?: (message: string) => void
  now?: Date
  fetchFn?: typeof fetch
  /** How often a followed `--url` is re-read. The endpoint is a snapshot, so there is nothing to wait on. */
  pollIntervalMs?: number
  /** `files` (the default, or `logs.source` in evlog.config) or `vercel`, the linked project's runtime logs. */
  source?: string
  /** `files`, `vercel` or an environment, comma-separated: refuse the read unless it matches. */
  expect?: string
  /** How the Vercel source gets its token and scope; tests stand in for Vercel Connect. */
  vercelAccess?: (project: VercelProject, connector: string) => Promise<VercelAccess>
}

const DAY_MS = 86_400_000

/** Log lines the Vercel source reads at most, newest first: ten pages of the API. */
const VERCEL_MAX_LINES = 10_000

/**
 * The linked project's runtime logs over `--since` (a day back by default,
 * Pro's retention) to `--until`. A session id narrows the read on Vercel's
 * side before evlog parses anything.
 */
async function readVercel(ctx: CliContext, options: RunLogsOptions, read: { query: LogsQuery, search?: string, connector: string, inRange: (event: WideEvent) => boolean, expect: Expectation }): Promise<LogsResult> {
  const { query, search, connector, inRange, expect } = read
  const project = await resolveProject(ctx.cwd)
  const linked = await findVercelProject(project.packageDir, project.root)
  if (!linked) throw cliErrors.LOGS_VERCEL_NOT_LINKED({ cwd: ctx.cwd })
  const { token, scope } = await (options.vercelAccess ?? resolveVercelAccess)(linked, connector)
  const origin: LogsOrigin = { kind: 'vercel', teamId: scope.teamId, projectId: scope.projectId, environments: [scope.environment] }
  checkExpectation(expect, origin)
  const now = options.now ?? new Date()
  const since = query.since ?? new Date(now.getTime() - DAY_MS)
  const reader = readVercelLogs({
    token,
    scope,
    since,
    until: query.until ?? now,
    search,
    maxLines: VERCEL_MAX_LINES,
    fetchFn: options.fetchFn,
  })
  const selection = createSelection<Sourced>(query, true)
  let summary: VercelLogsSummary
  try {
    for (let step = await reader.next(); ; step = await reader.next()) {
      if (step.done) {
        summary = step.value
        break
      }
      if (inRange(step.value)) selection.add(step.value)
    }
  } catch (error) {
    if (error instanceof VercelReadError) throw cliErrors.LOGS_VERCEL_READ_FAILED({ httpStatus: error.status, reason: error.message })
    throw error
  }
  const notes: string[] = []
  if (summary.truncated > 0) notes.push(`${summary.truncated} log line${summary.truncated === 1 ? ' was' : 's were'} cut by Vercel's size limit and skipped`)
  if (summary.more) notes.push(`read the newest ${summary.lines} log lines; narrow --since or pass --session to reach older ones`)
  return {
    sources: [`vercel ${scope.projectId} (${scope.environment})`],
    origin,
    window: { since: since.toISOString(), until: (query.until ?? now).toISOString() },
    coverage: notes.length > 0 ? { complete: false, reasons: notes } : { complete: true },
    query,
    ...selection.done(),
    ...(notes.length > 0 && { notes }),
  }
}

interface Expectation {
  source?: 'files' | 'vercel'
  environment?: string
}

function parseExpectation(value: string | undefined): Expectation {
  const expectation: Expectation = {}
  for (const token of (value ?? '').split(',').map(part => part.trim()).filter(Boolean)) {
    if (token === 'files' || token === 'vercel') expectation.source = token
    else expectation.environment = token
  }
  return expectation
}

/**
 * Refuses a read from another store or environment than the one asked for.
 * Files and URLs hold whatever environments wrote to them, so the check runs
 * on the ones the events in the window carry.
 */
function checkExpectation(expect: Expectation, origin: LogsOrigin): void {
  const kind = origin.kind === 'url' ? 'files' : origin.kind
  const sourceOff = expect.source !== undefined && expect.source !== kind
  const environmentOff = expect.environment !== undefined && !origin.environments.includes(expect.environment)
  if (!sourceOff && !environmentOff) return
  throw cliErrors.LOGS_SOURCE_MISMATCH({
    expected: [expect.source, expect.environment].filter(Boolean).join(', '),
    actual: `${origin.kind === 'vercel' ? `Vercel ${origin.projectId}` : origin.kind === 'url' ? 'a URL' : 'local files'} (${origin.environments.join(', ') || 'no events in the window'})`,
  })
}

function tag(event: WideEvent, name: string | undefined): Sourced {
  if (!name) return event
  return Object.defineProperty(event, SOURCE, { value: name, enumerable: false }) as Sourced
}

async function fetchEvents(url: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<WideEvent[]> {
  let response: Response
  try {
    response = await fetchFn(url, { headers: { accept: 'application/json' }, signal })
  } catch (error) {
    throw cliErrors.LOGS_URL_UNREACHABLE({ url, reason: error instanceof Error ? error.message : String(error) })
  }
  if (!response.ok) throw cliErrors.LOGS_URL_UNREACHABLE({ url, reason: `HTTP ${response.status}` })
  const body = await response.json() as unknown
  const events = Array.isArray(body) ? body : typeof body === 'object' && body !== null && Array.isArray((body as { events?: unknown }).events) ? (body as { events: unknown[] }).events : undefined
  if (!events) throw cliErrors.LOGS_URL_UNREACHABLE({ url, reason: 'the response is not a JSON array of events' })
  return events as WideEvent[]
}

/** Read the events the query asks for. Pure with respect to the context: nothing is written. */
export async function runLogs(ctx: CliContext, args: LogsArgs, options: RunLogsOptions = {}): Promise<LogsResult> {
  /* `logs.dir` and `logs.limit` stand in for the flags, so a project that
     writes somewhere unusual is read without passing `--dir` every time. */
  const config = loadCliConfig(await resolveProject(ctx.cwd))
  const query = buildQuery(args, options.now, config?.logs.limit)
  const dir = options.dir ?? config?.logs.dir
  const fetchFn = options.fetchFn ?? fetch
  const expect = parseExpectation(options.expect)
  const now = options.now ?? new Date()
  /* A one-shot read stops at the `until` it reports, so an event stamped ahead
     of the clock is not shown under a window that excludes it; following has no end. */
  const until = query.until ?? (options.follow ? undefined : now)
  /* The environments the events in the window carry, read before the
     filters drop any, so `--expect` judges the store and not the matches. */
  const environments = new Set<string>()
  const inWindow = (event: WideEvent): boolean => {
    const at = timeOf(event)
    if (query.since && at < query.since.getTime()) return false
    if (until && at > until.getTime()) return false
    if (typeof event.environment === 'string') environments.add(event.environment)
    return true
  }
  const keeps = (event: WideEvent): boolean => (!query.level || query.level.includes(event.level))
    && (expect.environment === undefined || event.environment === expect.environment)
    && query.filter(event)
  const inRange = (event: WideEvent): boolean => inWindow(event) && keeps(event)

  /* A flag says what this run reads; evlog.config says what runs read by default. */
  const source = options.source ?? (options.dir === undefined && options.url === undefined && !options.follow ? config?.logs.source : undefined)
  if (source !== undefined && source !== 'files' && source !== 'vercel') {
    throw cliErrors.LOGS_INVALID_SOURCE({ value: source })
  }
  if (source === 'vercel') {
    const conflict = options.follow ? 'follow' : options.dir !== undefined ? 'dir' : options.url !== undefined ? 'url' : undefined
    if (conflict) throw cliErrors.LOGS_SOURCE_CONFLICT({ flag: conflict })
    return readVercel(ctx, options, { query, search: args.session, connector: config?.logs.vercel?.connector ?? DEFAULT_VERCEL_CONNECTOR, inRange, expect })
  }
  if (expect.source === 'vercel') checkExpectation(expect, { kind: 'files', environments: [] })

  /* The endpoint answers with every event at once, so those are in memory
     either way; the files are read one event at a time. */
  let fetched: WideEvent[] = []
  let selected: Selected<Sourced>
  let sources: string[]
  if (options.url) {
    fetched = (await fetchEvents(options.url, fetchFn, options.signal)).filter(inRange)
    const selection = createSelection<Sourced>(query)
    for (const event of fetched) selection.add(event)
    selected = selection.done()
    sources = [options.url]
  } else {
    const found = await resolveLogsSources(ctx, dir)
    if (!options.follow && !found.some(source => existsSync(source.dir))) throw cliErrors.LOGS_NO_SINK({ cwd: ctx.cwd })
    const selection = createSelection<Sourced>(query, found.length > 1)
    for (const source of found) {
      for await (const event of readFsLogs({ dir: source.dir, since: query.since, until, filter: event => inWindow(event) && keeps(event) })) {
        selection.add(tag(event, found.length > 1 ? source.name : undefined))
      }
    }
    selected = selection.done()
    sources = found.map(source => prettyPath(ctx.cwd, source.dir))
  }
  const origin: LogsOrigin = { kind: options.url ? 'url' : 'files', environments: [...environments].sort() }
  checkExpectation(expect, origin)
  const result: LogsResult = {
    sources,
    origin,
    window: { ...(query.since && { since: query.since.toISOString() }), until: (query.until ?? now).toISOString() },
    coverage: { complete: true },
    query,
    ...selected,
  }

  if (options.follow) {
    /* `tail -f` shows the end of the file before it waits, and the caller only
       renders what it is handed, so the events already found go through the
       same path as the ones still to come. */
    for (const event of result.events) options.onEvent?.(event)
    if (options.url) await followUrl(options.url, fetched, inRange, options)
    else await followDirs(await resolveLogsSources(ctx, dir), query, options)
  }
  return result
}

async function followDirs(sources: LogsSource[], query: LogsQuery, options: RunLogsOptions): Promise<void> {
  const label = sources.length > 1
  await Promise.all(sources.map(async (source) => {
    for await (const event of tailFsLogs({ dir: source.dir, fromEnd: true, level: query.level, filter: query.filter, pollIntervalMs: 250, signal: options.signal })) {
      options.onEvent?.(tag(event, label ? source.name : undefined))
    }
  }))
}

/** What a poll of the endpoint has already shown: the newest instant, and every event at it. */
interface Seen {
  newest: number
  atNewest: Set<string>
}

function seenOf(events: WideEvent[], newest: number): Seen {
  return { newest, atNewest: new Set(events.filter(event => timeOf(event) === newest).map(event => JSON.stringify(event))) }
}

function isFresh(event: WideEvent, seen: Seen): boolean {
  const at = timeOf(event)
  return at > seen.newest || (at === seen.newest && !seen.atNewest.has(JSON.stringify(event)))
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((done) => {
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      done()
    }, { once: true })
  })
}

/**
 * Consecutive failed polls before the silence is reported. A restart takes a
 * few seconds, so warning on the first one would cry wolf; never warning
 * leaves a follower that looks alive and delivers nothing.
 */
const QUIET_POLLS = 5

/**
 * The endpoint is a snapshot, so following it means polling and keeping what
 * was already shown apart from what is new: an event later than the newest
 * shown, or one at the same instant that was not in the last snapshot.
 */
async function followUrl(url: string, shown: WideEvent[], inRange: (event: WideEvent) => boolean, options: RunLogsOptions): Promise<void> {
  const fetchFn = options.fetchFn ?? fetch
  let seen = seenOf(shown, shown.reduce((max, event) => Math.max(max, timeOf(event)), 0))
  let failures = 0
  while (!options.signal?.aborted) {
    await pause(options.pollIntervalMs ?? 1000, options.signal)
    if (options.signal?.aborted) return
    let events: WideEvent[]
    try {
      events = (await fetchEvents(url, fetchFn, options.signal)).filter(inRange)
      if (failures >= QUIET_POLLS) options.onNotice?.(`${url} is answering again`)
      failures = 0
    } catch (error) {
      /* A follower outlives the app it watches: a dev server restarting is a
         gap in the stream, not a reason to stop. */
      failures += 1
      if (failures === QUIET_POLLS) {
        options.onNotice?.(`no answer from ${url} for ${failures} polls (${error instanceof Error ? error.message : String(error)}) — still trying`)
      }
      continue
    }
    const fresh: WideEvent[] = []
    for (const event of events) {
      if (isFresh(event, seen)) fresh.push(event)
    }
    for (const event of fresh) options.onEvent?.(event)
    if (fresh.length > 0) seen = seenOf(events, fresh.reduce((max, event) => Math.max(max, timeOf(event)), seen.newest))
  }
}

/**
 * What `evlog logs` reports: how the reader was used, never what it read.
 *
 * The view is one of this CLI's own ids; the rest is counts and booleans. No
 * event, field name, filter value, path or URL.
 */
function logsTelemetryFields(
  result: Pick<LogsResult, 'matched' | 'sources'> & { query: Pick<LogsResult['query'], 'view' | 'where'> },
  run: { follow: boolean, url: boolean },
): Record<string, boolean | number | string> {
  return {
    logsView: result.query.view,
    logsFollow: run.follow,
    logsEvents: result.matched,
    logsWhere: result.query.where.length,
    logsSources: result.sources.length,
    logsUrl: run.url,
  }
}

/** Every field {@link logsTelemetryFields} can emit — used to keep the ingest allowlist in step. */
export function logsTelemetryFieldNames(): string[] {
  return Object.keys(logsTelemetryFields(
    { query: { view: 'recent', where: [] }, matched: 0, sources: [] },
    { follow: false, url: false },
  ))
}

/**
 * `evlog logs` — the wide events the app wrote, from the terminal.
 * Logic lives in {@link runLogs}; this file owns the citty surface.
 */
export default defineEvlogCommand('logs', {
  meta: { name: 'logs' },
  args: {
    what: { type: 'positional', required: false, description: '`errors`, `slow`, `stats`, `sessions`, or a request id to show in full' },
    session: { type: 'string', description: 'Only one AI conversation: its gen_ai.conversation.id, such as an eve session id' },
    follow: { type: 'boolean', alias: 'f', description: 'Keep reading as the app writes, like tail -f' },
    since: { type: 'string', description: 'Only events after this: a duration back (15m, 2h, 3d) or a date' },
    until: { type: 'string', description: 'Only events before this: a duration back or a date' },
    level: { type: 'string', description: 'Only these levels, comma-separated (error,fatal)' },
    path: { type: 'string', description: 'Only requests on this exact path' },
    status: { type: 'string', description: 'Only this status (500) or class (5xx)' },
    where: { type: 'string', description: 'Only events where a field matches: user.id=42, payment.amount>5000, error.message~declined, audit, !error (repeatable)' },
    over: { type: 'string', description: 'For `slow`: the duration a request has to exceed (default 500ms)' },
    limit: { type: 'string', description: 'Most events to show (default 50)' },
    source: { type: 'string', description: 'Where to read: files (default, or logs.source in evlog.config), or vercel for the linked project\'s runtime logs (set up once with evlog setup vercel)' },
    expect: { type: 'string', description: 'Refuse to answer from another store or environment: files, vercel, production, preview or development, comma-separated' },
    dir: { type: 'string', description: 'Log directory (default: the project\'s .evlog/logs, or every app\'s in a workspace)' },
    url: { type: 'string', description: 'Read the memory drain\'s dev endpoint instead of files (a JSON array of events)' },
  },
  async run({ args, rawArgs, cli, ui }) {
    const style = createStyle(cli)
    const controller = new AbortController()
    const stop = (): void => controller.abort()
    if (args.follow) process.once('SIGINT', stop)

    let result: LogsResult
    try {
      result = await runLogs(cli, { ...(args as LogsArgs), where: flagValues(rawArgs, 'where') }, {
        dir: args.dir,
        url: args.url,
        source: args.source,
        expect: args.expect,
        follow: args.follow,
        signal: controller.signal,
        onEvent: (event) => {
          if (args.json) ui.stdout(JSON.stringify(event))
          else ui.human(formatLine(style, event))
        },
        onNotice: message => ui.human(style.paint('dim', message)),
      })
    } catch (error) {
      if (error instanceof EvlogError) {
        telemetry.fail(error.code)
        ui.done({
          jsonMode: args.json,
          json: { error: { code: error.code, message: error.message, why: error.why, fix: error.fix } },
          human: error.fix ? `${error.message}\n→ ${error.fix}` : error.message,
        })
        ui.exit(isUsageError(error) ? EXIT_USAGE : EXIT_FAIL)
        return
      }
      throw error
    } finally {
      process.off('SIGINT', stop)
    }

    telemetry.set(logsTelemetryFields(result, { follow: args.follow === true, url: args.url !== undefined }) as unknown as Record<string, boolean | number>)

    /* While following, the one-shot part was already streamed line by line
       before the tail started, so the report is only for the one-shot run. */
    if (args.follow) return
    ui.done({
      jsonMode: args.json,
      json: {
        sources: result.sources,
        origin: result.origin,
        window: result.window,
        view: result.query.view,
        ...(result.query.view === 'slow' && { over: result.query.over }),
        count: result.sessions ? result.sessions.length : result.events.length,
        matched: result.matched,
        coverage: result.coverage,
        ...(result.notes && { notes: result.notes }),
        ...(result.sessions ? { sessions: result.sessions, sessionsMatched: result.sessionsMatched } : result.stats ? { stats: result.stats } : { events: result.events }),
      },
      human: args.json ? undefined : formatLogsReport(cli, result),
    })
  },
})
