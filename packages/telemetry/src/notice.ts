import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTelemetryDir } from './paths'

const DOCS_URL = 'https://evlog.dev/use-cases/telemetry/overview'
const DOCS_LABEL = 'evlog.dev › telemetry'

const c = {
  reset: '\x1B[0m',
  bold: '\x1B[1m',
  dim: '\x1B[2m',
  yellow: '\x1B[33m',
  cyan: '\x1B[36m',
  underline: '\x1B[4m',
} as const

const LABEL_WIDTH = 8

function useColors(): boolean {
  if (process.env.NO_COLOR !== undefined) return false
  if (process.env.FORCE_COLOR === '1' || process.env.FORCE_COLOR === '2' || process.env.FORCE_COLOR === '3') {
    return true
  }
  return isInteractiveTerminal()
}

/** True when stderr or stdout is a TTY (pnpm scripts often keep one of them). */
export function isInteractiveTerminal(): boolean {
  return process.stderr.isTTY === true || process.stdout.isTTY === true
}

function paint(code: string, text: string, enabled: boolean): string {
  return enabled ? `${code}${text}${c.reset}` : text
}

/** OSC 8 terminal hyperlink when colors are enabled. */
function terminalLink(url: string, label: string, color: boolean): string {
  if (!color) return `${label} (${url})`
  return `\x1B]8;;${url}\x07${paint(c.cyan + c.underline, label, true)}\x1B]8;;\x07`
}

function actionRow(label: string, body: string, color: boolean): string {
  const bar = paint(c.dim, '│ ', color)
  const name = paint(c.dim, label.padEnd(LABEL_WIDTH), color)
  return `  ${bar}${name}${body}`
}

/**
 * First-run disclosure notice for interactive terminals.
 * Respects `NO_COLOR`; plain text when colors are disabled.
 */
export function formatTelemetryNotice(bin: string): string {
  const color = useColors()
  const statusCmd = `${bin} telemetry status`
  const disableCmd = `${bin} telemetry disable`

  const brand = `${paint(c.dim, 'evlog', color)} ${paint(c.yellow + c.bold, 'telemetry', color)}`
  const headline = `${brand}${paint(c.dim, ' — anonymous usage enabled', color)}`

  const rows = [
    `  ${headline}`,
    actionRow('status', paint(c.cyan, statusCmd, color), color),
    actionRow('opt-out', paint(c.cyan, disableCmd, color), color),
    actionRow('docs', terminalLink(DOCS_URL, DOCS_LABEL, color), color),
  ]

  return `\n${rows.join('\n')}\n\n`
}

/** Whether the first-run notice was already shown for this tool. */
export function wasNoticeShown(toolName: string): boolean {
  try {
    readFileSync(join(getTelemetryDir(toolName), 'notice-shown'), 'utf-8')
    return true
  } catch {
    return false
  }
}
