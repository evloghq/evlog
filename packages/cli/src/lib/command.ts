import type { ArgsDef, CommandDef, CommandContext, CommandMeta, ParsedArgs, Resolvable } from 'citty'
import { defineCommand } from 'citty'
import { EvlogError } from 'evlog'
import { createContext } from '../core/context'
import type { CliContext } from '../core/context'
import { formatCommandHeader, wantsHeader } from '../core/brand'
import { EXIT_FAIL, writeHuman } from '../core/output'
import { withCliDebug } from './debug'
import type { CliDebug, DebugArgs } from './debug'
import { createUi } from './ui'
import type { CliUi } from './ui'

/**
 * Args injected on every {@link defineEvlogCommand} leaf.
 * Commands may still declare their own; these are merged in (command wins on clash).
 */
export const COMMON_ARGS = {
  json: { type: 'boolean', description: 'Machine-readable JSON on stdout' },
  debug: { type: 'boolean', description: 'Emit a debug case file via evlog' },
  noHeader: { type: 'boolean', description: 'Skip the branded command header' },
  cwd: { type: 'string', description: 'Project directory (default: current)' },
} as const satisfies ArgsDef

/** Citty context plus CLI helpers injected by {@link defineEvlogCommand}. */
export type EvlogRunContext<T extends ArgsDef = ArgsDef> = CommandContext<T> & {
  /** Process / terminal context (cwd, env, color, …). */
  cli: CliContext
  /**
   * Debug handle — always present. No-ops when `--debug` is off;
   * `log.step` still executes the work.
   */
  log: CliDebug
  /**
   * Terminal output — `human` (stderr), `json` (stdout), `exit`, `done`.
   * Prefer this over touching `process.stdout` / `exitCode` in commands.
   */
  ui: CliUi
}

export type EvlogCommandDef<T extends ArgsDef = {}> = Omit<CommandDef<T>, 'run' | 'args'> & {
  args?: T
  /**
   * Suppress the branded header for this run.
   *
   * For commands that draw their own frame — `init` opens a clack session with
   * its own intro, and stacking the ASCII header on top of it reads as two
   * programs starting. Global flags (`--no-header`, `--json`) still win.
   */
  skipHeader?: (ctx: CliContext, args: ParsedArgs<T & typeof COMMON_ARGS>) => boolean
  run?: (ctx: EvlogRunContext<T & typeof COMMON_ARGS>) => ReturnType<NonNullable<CommandDef<T>['run']>>
}

function runArgs(args: unknown): DebugArgs & { noHeader?: boolean, cwd?: string } {
  const a = args as DebugArgs & { noHeader?: boolean, cwd?: string }
  return { json: a?.json, noHeader: a?.noHeader, debug: a?.debug, cwd: a?.cwd || undefined }
}

function syncMeta(meta: CommandDef['meta']): CommandMeta {
  if (meta && typeof meta === 'object' && !('then' in meta)) {
    return meta
  }
  return {}
}

/**
 * Define a citty command with branded header, shared flags, debug filet, and `ui`.
 *
 * `run` receives `{ …citty, cli, log, ui }`.
 *
 * @example
 * ```ts
 * export default defineEvlogCommand('audit', {
 *   meta: { description: '…' },
 *   args: { since: { type: 'string' } },
 *   async run({ args, cli, log, ui }) {
 *     const data = await log.step('load', () => load(cli.cwd))
 *     ui.done({
 *       jsonMode: args.json,
 *       json: { data },
 *       human: format(data),
 *       summary: { ok: 1, warn: 0, fail: 0 },
 *     })
 *   },
 * })
 * ```
 */
export function defineEvlogCommand<T extends ArgsDef = {}>(
  command: string,
  def: EvlogCommandDef<T>,
): CommandDef<T & typeof COMMON_ARGS> {
  const baseMeta = syncMeta(def.meta)
  const args = {
    ...COMMON_ARGS,
    ...def.args,
  } as T & typeof COMMON_ARGS

  return defineCommand({
    ...def,
    args,
    meta: {
      ...baseMeta,
      name: baseMeta.name ?? command.split(' ').at(-1),
    },
    async run(ctx: CommandContext<T & typeof COMMON_ARGS>) {
      const flags = runArgs(ctx.args)
      const cli = createContext(flags.cwd ? { cwd: flags.cwd } : {})
      if (wantsHeader(cli, flags) && !def.skipHeader?.(cli, ctx.args)) {
        writeHuman(formatCommandHeader(cli, { command }))
      }
      const ui = createUi({ json: flags.json })
      return await withCliDebug(cli, { command, ...flags }, async (log) => {
        return await def.run?.({ ...ctx, cli, log, ui })
      })
    },
  } as CommandDef<T & typeof COMMON_ARGS>)
}

/**
 * Render a catalog error and exit 1; rethrow anything unexpected.
 *
 * Shared because every command that writes needs the same three things from a
 * failure — the finding on the debug event, the `why` / `fix` for the reader,
 * and a non-zero exit — and three copies of that would drift.
 */
export function failWith(
  error: unknown,
  io: { args: { json?: boolean }, log: CliDebug, ui: CliUi },
): void {
  if (!(error instanceof EvlogError)) throw error
  io.log.finding(
    { code: error.code ?? 'cli.COMMAND_FAILED', why: error.why, fix: error.fix, link: error.link },
    { status: 'fail' },
  )
  io.ui.done({
    jsonMode: io.args.json,
    json: { error: { code: error.code, message: error.message, why: error.why, fix: error.fix } },
    human: error.fix ? `${error.message}\n→ ${error.fix}` : error.message,
  })
  io.ui.exit(EXIT_FAIL)
}

async function resolve<T>(value: Resolvable<T>): Promise<T> {
  return typeof value === 'function' ? await (value as () => T | Promise<T>)() : await value
}

/**
 * A command whose module loads on first use.
 *
 * `meta` lives here so `evlog --help` can list every command without importing
 * any of them; the module's own `meta` only needs a `name`. `args`,
 * `subCommands` and `run` all go through citty's lazy resolution, so the import
 * happens once, when the command is actually selected.
 *
 * A `group` has subcommands and no work of its own. citty runs a parent's `run`
 * after the selected subcommand and only reports `No command specified.` when
 * the parent has none, so a group must not declare one: with it, `evlog
 * telemetry status` would record a second telemetry event for `telemetry`, and
 * a bare `evlog telemetry` would exit silently.
 */
export function lazyCommand(
  meta: CommandMeta,
  load: () => Promise<{ default: CommandDef<any> }>,
  options: { group?: boolean } = {},
): CommandDef<any> {
  let pending: Promise<CommandDef<any>> | undefined
  const command = () => (pending ??= load().then(module => module.default))
  return {
    meta,
    args: async () => (await resolve((await command()).args)) ?? {},
    subCommands: async () => (await resolve((await command()).subCommands)) ?? {},
    ...(options.group ? {} : { run: async ctx => (await command()).run?.(ctx) }),
  }
}
