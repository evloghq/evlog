import { createLogger, EvlogError, initLogger } from 'evlog'
import type { RequestLogger } from 'evlog'
import type { CliContext } from '../core/context'
import type { CheckStatus } from '../core/output'
import { writeHuman } from '../core/output'
import { VERSION } from './constants'
import { formatDebugReport } from './debug-report'
import { resolveCliEnvironment } from './environment'
import { cliErrors } from './errors'

export type DebugArgs = { debug?: boolean, json?: boolean }

/** Soft finding attached to the debug wide event (catalog-backed). */
export interface CliFinding {
  code: string
  status?: CheckStatus
  id?: string
  why?: string
  fix?: string
  link?: string
}

/**
 * Catalog factory shape (`cliErrors.X`) — static `code` / `why` / `fix` / `link`
 * from {@link import('evlog').defineError}.
 */
export type CatalogFindingSource = {
  code: string
  why?: unknown
  fix?: unknown
  link?: unknown
}

type StepFields<T>
  = Record<string, unknown>
    | ((result: T) => Record<string, unknown> | undefined)

/**
 * Debug handle for one CLI command invocation.
 *
 * Always available from {@link import('./command').defineEvlogCommand}:
 * when `--debug` is off, `step` still runs the work and `finding` / `set` no-op.
 */
export interface CliDebug {
  /** Underlying request logger when debug is on. */
  readonly raw: RequestLogger | undefined

  /**
   * Run work as a named checkpoint. Appends to `steps` when debug is on.
   * On throw, still records the step as failed, then rethrows.
   */
  step: <T>(
    name: string,
    fn: () => T | Promise<T>,
    fields?: StepFields<T>,
  ) => Promise<T>

  /**
   * Append a catalog-backed finding.
   *
   * @example
   * ```ts
   * log.finding(cliErrors.EVLOG_NOT_FOUND, { id: 'evlog', status: 'warn' })
   * ```
   */
  finding: (
    source: CliFinding | CatalogFindingSource,
    extras?: Pick<CliFinding, 'status' | 'id'>,
  ) => void

  /** Merge arbitrary fields into the wide event when debug is on. */
  set: (fields: Record<string, unknown>) => void
}

let loggerReady = false

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function toCliFinding(
  source: CliFinding | CatalogFindingSource,
  extras?: Pick<CliFinding, 'status' | 'id'>,
): CliFinding {
  const s = source as CliFinding
  const status = extras?.status
    ?? (s.status === 'ok' || s.status === 'warn' || s.status === 'fail' ? s.status : undefined)
    ?? 'warn'

  return {
    code: source.code,
    why: asOptionalString(source.why),
    fix: asOptionalString(source.fix),
    link: asOptionalString(source.link),
    id: extras?.id ?? (typeof s.id === 'string' ? s.id : undefined),
    status,
  }
}

function resolveFields<T>(
  fields: StepFields<T> | undefined,
  result: T,
): Record<string, unknown> | undefined {
  if (!fields) return undefined
  if (typeof fields === 'function') return fields(result) ?? undefined
  return fields
}

/** Live debug handle backed by a request logger. */
export function createCliDebug(log: RequestLogger): CliDebug {
  return {
    raw: log,
    async step(name, fn, fields) {
      try {
        const result = await fn()
        const extra = resolveFields(fields, result)
        log.set({ steps: [name], ...extra })
        return result
      } catch (error) {
        log.set({ steps: [name], stepFailed: name })
        throw error
      }
    },
    finding(source, extras) {
      log.set({ findings: [toCliFinding(source, extras)] })
    },
    set(fields) {
      log.set(fields)
    },
  }
}

/** No-op debug handle — `step` still executes `fn`. */
export function createNoopCliDebug(): CliDebug {
  return {
    raw: undefined,
    async step(_name, fn) {
      return await fn()
    },
    finding() {},
    set() {},
  }
}

/**
 * Whether CLI debug wide events should run.
 *
 * Enabled when:
 * - `--debug` (flag on the command or anywhere on argv)
 * - `EVLOG_CLI_DEBUG=1`
 *
 * Independent of `@evlog/telemetry` / `EVLOG_TELEMETRY_DEBUG`.
 */
export function wantsDebug(
  ctx: Pick<CliContext, 'env'>,
  args?: DebugArgs,
  argv: readonly string[] = process.argv,
): boolean {
  if (args?.debug) return true
  if (ctx.env.EVLOG_CLI_DEBUG === '1') return true
  if (argv.includes('--debug')) return true
  return false
}

/**
 * One-time `initLogger` for CLI debug.
 *
 * - Human (`--debug`): compact case-file report on stderr
 * - JSON (`--json --debug`): raw wide event JSON on stderr
 */
export function ensureCliDebugLogger(options: { json?: boolean, color?: boolean } = {}): void {
  if (loggerReady) return
  loggerReady = true

  const json = options.json === true
  const color = options.color === true

  initLogger({
    env: {
      service: 'evlog-cli',
      version: VERSION,
      environment: resolveCliEnvironment(),
    },
    pretty: false,
    silent: true,
    minLevel: 'debug',
    _suppressDrainWarning: true,
    drain: ({ event }) => {
      writeHuman(json ? JSON.stringify(event) : formatDebugReport(event as Record<string, unknown>, { color }))
    },
  })
}

/** Create a request logger for one CLI command invocation. */
export function createCliLogger(seed: Record<string, unknown> = {}): RequestLogger {
  return createLogger(seed)
}

/**
 * Run `fn` with a {@link CliDebug} handle. Always passes a handle:
 * live when debug is on, no-op (but `step` still runs work) when off.
 *
 * Emits once in `finally` when debug is on. Unexpected throws become
 * {@link cliErrors.COMMAND_FAILED} when not already an {@link EvlogError}.
 */
export async function withCliDebug<T>(
  ctx: CliContext,
  options: { command: string } & DebugArgs,
  fn: (log: CliDebug) => Promise<T> | T,
): Promise<T> {
  if (!wantsDebug(ctx, options)) {
    return await fn(createNoopCliDebug())
  }

  ensureCliDebugLogger({ json: options.json, color: ctx.color })
  const raw = createCliLogger({
    command: options.command,
    cliVersion: VERSION,
    environment: resolveCliEnvironment(),
  })
  const log = createCliDebug(raw)

  try {
    return await fn(log)
  } catch (error) {
    if (error instanceof EvlogError) {
      raw.error(error)
    } else {
      raw.error(cliErrors.COMMAND_FAILED({
        cause: error instanceof Error ? error : undefined,
        message: error instanceof Error ? error.message : String(error),
      }))
    }
    throw error
  } finally {
    raw.emit()
  }
}

/** Reset module state — tests only. */
export function resetCliDebugLoggerForTests(): void {
  loggerReady = false
}
