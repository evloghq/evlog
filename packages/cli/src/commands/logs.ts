import { existsSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { telemetry } from '@evlog/telemetry'
import { EvlogError } from 'evlog'
import type { WideEvent } from 'evlog'
import { readFsLogs, tailFsLogs } from 'evlog/fs'
import type { CliContext } from '../core/context'
import { createStyle, EXIT_FAIL, EXIT_USAGE } from '../core/output'
import { defineEvlogCommand } from '../lib/command'
import { cliErrors } from '../lib/errors'
import { buildQuery, computeStats, select } from '../lib/logs/query'
import type { LogsArgs, LogsQuery } from '../lib/logs/query'
import { formatLine, formatLogsReport, SOURCE } from '../lib/logs/render'
import type { LogsResult, Sourced } from '../lib/logs/render'
import { findConfiguredFsDrain, findLogsSink, prettyPath, resolveProject } from '../lib/project'
import type { ProjectInfo } from '../lib/project'

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
  now?: Date
  fetchFn?: typeof fetch
}

function tag(event: WideEvent, name: string | undefined): Sourced {
  if (!name) return event
  return Object.defineProperty(event, SOURCE, { value: name, enumerable: false }) as Sourced
}

async function fetchEvents(url: string, fetchFn: typeof fetch): Promise<WideEvent[]> {
  let response: Response
  try {
    response = await fetchFn(url, { headers: { accept: 'application/json' } })
  } catch (error) {
    throw cliErrors.LOGS_URL_UNREACHABLE({ url, reason: error instanceof Error ? error.message : String(error) })
  }
  if (!response.ok) throw cliErrors.LOGS_URL_UNREACHABLE({ url, reason: `HTTP ${response.status}` })
  const body = await response.json() as unknown
  const events = Array.isArray(body) ? body : typeof body === 'object' && body !== null && Array.isArray((body as { events?: unknown }).events) ? (body as { events: unknown[] }).events : undefined
  if (!events) throw cliErrors.LOGS_URL_UNREACHABLE({ url, reason: 'the response is not a JSON array of events' })
  return events as WideEvent[]
}

const timeOf = (event: WideEvent): number => Date.parse(event.timestamp) || 0

/** Read the events the query asks for. Pure with respect to the context: nothing is written. */
export async function runLogs(ctx: CliContext, args: LogsArgs, options: RunLogsOptions = {}): Promise<LogsResult> {
  const query = buildQuery(args, options.now)
  const fetchFn = options.fetchFn ?? fetch
  const inRange = (event: WideEvent): boolean => {
    const at = timeOf(event)
    if (query.since && at < query.since.getTime()) return false
    if (query.until && at > query.until.getTime()) return false
    if (query.level && !query.level.includes(event.level)) return false
    return query.filter(event)
  }

  let all: Sourced[]
  let sources: string[]
  if (options.url) {
    all = (await fetchEvents(options.url, fetchFn)).filter(inRange)
    sources = [options.url]
  } else {
    const found = await resolveLogsSources(ctx, options.dir)
    if (!options.follow && !found.some(source => existsSync(source.dir))) throw cliErrors.LOGS_NO_SINK({ cwd: ctx.cwd })
    all = []
    for (const source of found) {
      for await (const event of readFsLogs({ dir: source.dir, since: query.since, until: query.until, level: query.level, filter: query.filter })) {
        all.push(tag(event, found.length > 1 ? source.name : undefined))
      }
    }
    if (found.length > 1) all.sort((a, b) => timeOf(a) - timeOf(b))
    sources = found.map(source => prettyPath(ctx.cwd, source.dir))
  }
  const result: LogsResult = { sources, query, matched: all.length, events: select(all, query), all }

  if (options.follow) {
    /* `tail -f` shows the end of the file before it waits, and the caller only
       renders what it is handed, so the events already found go through the
       same path as the ones still to come. */
    for (const event of result.events) options.onEvent?.(event)
    if (options.url) await followUrl(options.url, all, inRange, options)
    else await followDirs(await resolveLogsSources(ctx, options.dir), query, options)
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
 * The endpoint is a snapshot, so following it means polling and keeping what
 * was already shown apart from what is new: an event later than the newest
 * shown, or one at the same instant that was not in the last snapshot.
 */
async function followUrl(url: string, shown: WideEvent[], inRange: (event: WideEvent) => boolean, options: RunLogsOptions): Promise<void> {
  const fetchFn = options.fetchFn ?? fetch
  let seen = seenOf(shown, shown.reduce((max, event) => Math.max(max, timeOf(event)), 0))
  while (!options.signal?.aborted) {
    await pause(1000, options.signal)
    if (options.signal?.aborted) return
    let events: WideEvent[]
    try {
      events = (await fetchEvents(url, fetchFn)).filter(inRange)
    } catch {
      /* A follower outlives the app it watches: a dev server restarting is a
         gap in the stream, not a reason to stop. */
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
 * `evlog logs` — the wide events the app wrote, from the terminal.
 * Logic lives in {@link runLogs}; this file owns the citty surface.
 */
export default defineEvlogCommand('logs', {
  meta: { name: 'logs' },
  args: {
    what: { type: 'positional', required: false, description: '`errors`, `slow`, `stats`, or a request id to show in full' },
    follow: { type: 'boolean', alias: 'f', description: 'Keep reading as the app writes, like tail -f' },
    since: { type: 'string', description: 'Only events after this: a duration back (15m, 2h, 3d) or a date' },
    until: { type: 'string', description: 'Only events before this: a duration back or a date' },
    level: { type: 'string', description: 'Only these levels, comma-separated (error,fatal)' },
    path: { type: 'string', description: 'Only requests on this exact path' },
    status: { type: 'string', description: 'Only this status (500) or class (5xx)' },
    where: { type: 'string', description: 'Only events where a field matches: user.id=42, payment.amount>5000, error.message~declined, audit, !error (repeatable)' },
    over: { type: 'string', description: 'For `slow`: the duration a request has to exceed (default 500ms)' },
    limit: { type: 'string', description: 'Most events to show (default 50)' },
    dir: { type: 'string', description: 'Log directory (default: the project\'s .evlog/logs, or every app\'s in a workspace)' },
    url: { type: 'string', description: 'Read the memory drain\'s dev endpoint instead of files (a JSON array of events)' },
  },
  async run({ args, cli, ui }) {
    const style = createStyle(cli)
    const controller = new AbortController()
    const stop = (): void => controller.abort()
    if (args.follow) process.once('SIGINT', stop)

    let result: LogsResult
    try {
      result = await runLogs(cli, args as LogsArgs, {
        dir: args.dir,
        url: args.url,
        follow: args.follow,
        signal: controller.signal,
        onEvent: (event) => {
          if (args.json) ui.stdout(JSON.stringify(event))
          else ui.human(formatLine(style, event))
        },
      })
    } catch (error) {
      if (error instanceof EvlogError) {
        ui.done({
          jsonMode: args.json,
          json: { error: { code: error.code, message: error.message, why: error.why, fix: error.fix } },
          human: error.fix ? `${error.message}\n→ ${error.fix}` : error.message,
        })
        const failed = error.code === cliErrors.LOGS_NO_SINK.code || error.code === cliErrors.LOGS_URL_UNREACHABLE.code
        ui.exit(failed ? EXIT_FAIL : EXIT_USAGE)
        return
      }
      throw error
    } finally {
      process.off('SIGINT', stop)
    }

    telemetry.set({
      logsView: result.query.view,
      logsFollow: args.follow === true,
      logsEvents: result.matched,
      logsWhere: result.query.where.length,
      logsSources: result.sources.length,
      logsUrl: args.url !== undefined,
    } as unknown as Record<string, boolean | number>)

    /* While following, the one-shot part was already streamed line by line
       before the tail started, so the report is only for the one-shot run. */
    if (args.follow) return
    ui.done({
      jsonMode: args.json,
      json: {
        sources: result.sources,
        view: result.query.view,
        count: result.events.length,
        matched: result.matched,
        ...(result.query.view === 'stats' ? { stats: computeStats(result.all) } : { events: result.events }),
      },
      human: formatLogsReport(cli, result),
    })
  },
})
