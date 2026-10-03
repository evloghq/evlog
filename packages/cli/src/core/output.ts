import { resolveCliEnvironment } from '../lib/environment'
import type { CliContext } from './context'

export const DOCS_URL = 'https://evlog.dev'
export const DOCS_LABEL = 'evlog.dev'

/** Current CLI result schema. Bump when a `--json` payload shape changes. */
export const SCHEMA_VERSION = 2

/** Documented exit codes: 0 ok (warns allowed), 1 any fail, 2 usage error. */
export const EXIT_OK = 0
export const EXIT_FAIL = 1
export const EXIT_USAGE = 2

const codes = {
  reset: '\x1B[0m',
  bold: '\x1B[1m',
  dim: '\x1B[2m',
  underline: '\x1B[4m',
  red: '\x1B[31m',
  green: '\x1B[32m',
  yellow: '\x1B[33m',
  blue: '\x1B[34m',
  magenta: '\x1B[35m',
  cyan: '\x1B[36m',
  white: '\x1B[37m',
} as const

/** A style name accepted by {@link Style.paint}. */
export type StyleCode = keyof typeof codes

/**
 * Minimal ANSI kit bound to a {@link CliContext} — hand-rolled like
 * evlog's pretty printer and the telemetry notice, no color dependency.
 */
export interface Style {
  paint: (code: StyleCode | StyleCode[], text: string) => string
  link: (url: string, label: string) => string
}

/** Create the styling helpers for a context (honors `NO_COLOR` / non-TTY). */
export function createStyle(ctx: Pick<CliContext, 'color'>): Style {
  const paint = (code: StyleCode | StyleCode[], text: string): string => {
    if (!ctx.color) return text
    const seq = (Array.isArray(code) ? code : [code]).map(k => codes[k]).join('')
    return `${seq}${text}${codes.reset}`
  }
  const link = (url: string, label: string): string => {
    if (!ctx.color) return `${label} (${url})`
    return `\x1B]8;;${url}\x07${paint(['cyan', 'underline'], label)}\x1B]8;;\x07`
  }
  return { paint, link }
}

/** Status of a single diagnostic check. */
export type CheckStatus = 'ok' | 'warn' | 'fail'

/** Shared glyphs for check / finding status (doctor report + debug case file). */
export const CHECK_STATUS: Record<CheckStatus, { glyph: string, color: StyleCode }> = {
  ok: { glyph: '✓', color: 'green' },
  warn: { glyph: '⚠', color: 'yellow' },
  fail: { glyph: '✗', color: 'red' },
}

/** One diagnostic check result — commands return these, never print. */
export interface Check {
  id: string
  status: CheckStatus
  message: string
  hint?: string
}

/** Aggregate counts over a list of checks. */
export interface CheckSummary {
  ok: number
  warn: number
  fail: number
}

/** Count check statuses. */
export function summarize(checks: Check[]): CheckSummary {
  const summary: CheckSummary = { ok: 0, warn: 0, fail: 0 }
  for (const check of checks) summary[check.status]++
  return summary
}

/** Exit code for a set of checks: 1 when any check failed, 0 otherwise. */
export function exitCodeFor(summary: CheckSummary): number {
  return summary.fail > 0 ? EXIT_FAIL : EXIT_OK
}

/**
 * Render checks as a blue-railed list with ✓ / ⚠ / ✗, cyan ids, and dim hints.
 */
export function formatChecks(ctx: Pick<CliContext, 'color'>, checks: Check[]): string {
  if (checks.length === 0) return ''
  const { paint } = createStyle(ctx)
  const width = Math.max(...checks.map(c => c.id.length))
  const rail = paint('blue', '│')
  const lines: string[] = []

  for (const check of checks) {
    const { glyph, color } = CHECK_STATUS[check.status]
    const symbol = paint(color, glyph)
    const id = paint('cyan', check.id.padEnd(width))
    lines.push(`${rail} ${symbol} ${id}  ${check.message}`)
    if (check.hint && check.status !== 'ok') {
      lines.push(`${rail}   ${paint('dim', `└ ${check.hint}`)}`)
    }
  }

  return lines.join('\n')
}

/** One-line footer: `3 ok · 1 warn · 0 fail`. */
export function formatSummary(ctx: Pick<CliContext, 'color'>, summary: CheckSummary): string {
  const { paint } = createStyle(ctx)
  const parts = [
    paint(summary.ok > 0 ? 'green' : 'dim', `${summary.ok} ok`),
    paint(summary.warn > 0 ? 'yellow' : 'dim', `${summary.warn} warn`),
    paint(summary.fail > 0 ? 'red' : 'dim', `${summary.fail} fail`),
  ]
  return parts.join(paint('dim', ' · '))
}

/**
 * Write a `--json` payload — the only thing allowed on stdout in JSON mode.
 * Always includes `schemaVersion` and `environment`; breaking the shape requires a bump.
 */
export function writeJson(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    environment: resolveCliEnvironment(),
    ...payload,
  })}\n`)
}

/** Set the process exit code without ending the run, so pending output still flushes. */
export function setExitCode(code: number): void {
  process.exitCode = code
}

/** Write a payload that follows someone else's contract to stdout, without the evlog envelope. */
export function writeStdout(text: string): void {
  process.stdout.write(`${text}\n`)
}

/** Write human-readable output to stderr (stdout is reserved for `--json`). */
export function writeHuman(text: string): void {
  process.stderr.write(`${text}\n`)
}
