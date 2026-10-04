import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { telemetry } from '@evlog/telemetry'
import { EvlogError } from 'evlog'
import type { WideEvent } from 'evlog'
import { readFsLogs, tailFsLogs } from 'evlog/fs'
import type { CliContext } from '../core/context'
import { createStyle, EXIT_FAIL, EXIT_USAGE } from '../core/output'
import { defineEvlogCommand } from '../lib/command'
import { cliErrors } from '../lib/errors'
import { buildQuery, select } from '../lib/logs/query'
import type { LogsArgs, LogsQuery } from '../lib/logs/query'
import { formatLine, formatLogsReport } from '../lib/logs/render'
import type { LogsResult } from '../lib/logs/render'
import { findConfiguredFsDrain, findLogsSink, resolveProject } from '../lib/project'

export type { LogsResult } from '../lib/logs/render'

/**
 * Where the events are. `--dir` wins; otherwise the sink the project already
 * writes to, or the directory its fs drain is configured for, which may not
 * exist yet when nothing has run.
 */
export async function resolveLogsDir(ctx: CliContext, dir: string | undefined): Promise<string> {
  if (dir) return resolve(ctx.cwd, dir)
  const project = await resolveProject(ctx.cwd)
  const sink = await findLogsSink(project)
  if (sink) return sink.dir
  const configured = await findConfiguredFsDrain(project, ctx.env)
  if (configured) return resolve(project.packageDir, configured.dir)
  throw cliErrors.LOGS_NO_SINK({ cwd: ctx.cwd })
}

export interface RunLogsOptions {
  dir?: string
  /** Keep reading as the app writes; resolves when `signal` aborts. */
  follow?: boolean
  signal?: AbortSignal
  /** Called for each event that arrives while following. */
  onEvent?: (event: WideEvent) => void
  now?: Date
}

/** Read the events the query asks for. Pure with respect to the context: nothing is written. */
export async function runLogs(ctx: CliContext, args: LogsArgs, options: RunLogsOptions = {}): Promise<LogsResult> {
  const query = buildQuery(args, options.now)
  const dir = await resolveLogsDir(ctx, options.dir)
  if (!existsSync(dir) && !options.follow) throw cliErrors.LOGS_NO_SINK({ cwd: ctx.cwd })

  const matched: WideEvent[] = []
  for await (const event of readFsLogs({ dir, since: query.since, until: query.until, level: query.level, filter: query.filter })) {
    matched.push(event)
  }
  const result: LogsResult = { dir, query, matched: matched.length, events: select(matched, query) }

  if (options.follow) {
    await followLogs(dir, query, options)
  }
  return result
}

async function followLogs(dir: string, query: LogsQuery, options: RunLogsOptions): Promise<void> {
  for await (const event of tailFsLogs({ dir, fromEnd: true, level: query.level, filter: query.filter, pollIntervalMs: 250, signal: options.signal })) {
    options.onEvent?.(event)
  }
}

/**
 * `evlog logs` — the wide events the app wrote, from the terminal.
 * Logic lives in {@link runLogs}; this file owns the citty surface.
 */
export default defineEvlogCommand('logs', {
  meta: { name: 'logs' },
  args: {
    what: { type: 'positional', required: false, description: '`errors`, `slow`, or a request id to show in full' },
    follow: { type: 'boolean', alias: 'f', description: 'Keep reading as the app writes, like tail -f' },
    since: { type: 'string', description: 'Only events after this: a duration back (15m, 2h, 3d) or a date' },
    until: { type: 'string', description: 'Only events before this: a duration back or a date' },
    level: { type: 'string', description: 'Only these levels, comma-separated (error,fatal)' },
    path: { type: 'string', description: 'Only requests on this exact path' },
    status: { type: 'string', description: 'Only this status (500) or class (5xx)' },
    over: { type: 'string', description: 'For `slow`: the duration a request has to exceed (default 500ms)' },
    limit: { type: 'string', description: 'Most events to show (default 50)' },
    dir: { type: 'string', description: 'Log directory (default: the project\'s .evlog/logs)' },
  },
  async run({ args, cli, ui }) {
    const style = createStyle(cli)
    const controller = new AbortController()
    const stop = (): void => controller.abort()
    if (args.follow) process.once('SIGINT', stop)

    let result: LogsResult
    try {
      result = await runLogs(cli, args, {
        dir: args.dir,
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
        ui.exit(error.code === cliErrors.LOGS_NO_SINK.code ? EXIT_FAIL : EXIT_USAGE)
        return
      }
      throw error
    } finally {
      process.off('SIGINT', stop)
    }

    telemetry.set({ logsView: result.query.view, logsFollow: args.follow === true, logsEvents: result.matched } as unknown as Record<string, boolean | number>)

    /* While following, the one-shot part was already streamed line by line
       before the tail started, so the report is only for the one-shot run. */
    if (args.follow) return
    ui.done({
      jsonMode: args.json,
      json: { dir: result.dir, view: result.query.view, count: result.events.length, matched: result.matched, events: result.events },
      human: formatLogsReport(cli, result),
    })
  },
})
