import { homedir } from 'node:os'

/**
 * Execution context passed to every command.
 * The only place allowed to read `process.*` — commands stay pure and testable.
 *
 * Debug instrumentation uses {@link import('../lib/debug').CliDebug} from
 * {@link import('../lib/command').defineEvlogCommand}, not this object.
 */
export interface CliContext {
  /** Working directory used to resolve the host project. */
  cwd: string
  /** Home directory — where agents keep their global, cross-project files. */
  home: string
  /** Environment snapshot — commands never touch `process.env` directly. */
  env: Record<string, string | undefined>
  /** Running Node.js version, e.g. `v22.1.0`. */
  nodeVersion: string
  /** Whether the terminal is interactive (stdout or stderr is a TTY). */
  tty: boolean
  /**
   * Whether stdin is a terminal.
   *
   * Separate from {@link tty} because they answer different questions: `tty`
   * says output can be styled, this says a prompt has somebody to answer it.
   * A run with piped stdin and a terminal stdout has one and not the other.
   */
  stdinTty: boolean
  /** Whether ANSI styling should be emitted. */
  color: boolean
  /** Whether 24-bit colors can be emitted. Never set without {@link color}. */
  truecolor: boolean
  /** Terminal width in columns (80 when unknown). */
  columns: number
}

/** The part of `process.stdout` and `process.stderr` the context reads. */
export interface OutputStream {
  isTTY?: boolean
  getColorDepth?: (env?: object) => number
}

function isInteractive(): boolean {
  return process.stdout.isTTY === true || process.stderr.isTTY === true
}

/** Color depth in bits for each `FORCE_COLOR` level that turns colors on. */
const FORCED_DEPTH: Record<string, number> = { 1: 4, 2: 8, 3: 24 }

/**
 * How many bits of color `stream` shows: 1 is none, 24 is truecolor.
 *
 * `NO_COLOR` wins over everything. A terminal answers for itself, which covers
 * `FORCE_COLOR`, `TERM=dumb` and `COLORTERM`; anything else shows colors only
 * when `FORCE_COLOR` asks for them.
 */
function colorDepth(stream: OutputStream, env: Record<string, string | undefined>): number {
  if (env.NO_COLOR !== undefined) return 1
  if (stream.isTTY && stream.getColorDepth) return stream.getColorDepth(env)
  return FORCED_DEPTH[env.FORCE_COLOR ?? ''] ?? 1
}

/**
 * Build the {@link CliContext} for the current process.
 * Pass `overrides` in tests to fake cwd, env, or terminal capabilities.
 *
 * @param stream - Where the text styled with this context is written. Colors
 * follow that stream alone, so a report redirected to a file stays plain next
 * to a terminal.
 * @default process.stderr
 */
export function createContext(overrides: Partial<CliContext> = {}, stream: OutputStream = process.stderr): CliContext {
  const env = overrides.env ?? { ...process.env }
  const depth = colorDepth(stream, env)
  const color = overrides.color ?? depth > 1
  return {
    cwd: overrides.cwd ?? process.cwd(),
    home: overrides.home ?? homedir(),
    env,
    nodeVersion: overrides.nodeVersion ?? process.version,
    tty: overrides.tty ?? isInteractive(),
    stdinTty: overrides.stdinTty ?? process.stdin.isTTY === true,
    color,
    truecolor: overrides.truecolor ?? (color && depth === 24),
    columns: overrides.columns ?? process.stdout.columns ?? process.stderr.columns ?? 80,
  }
}
