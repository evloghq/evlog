import { version as VERSION } from '../../package.json'
import type { CliContext } from './context'
import { DOCS_LABEL, DOCS_URL, createStyle } from './output'

/** Brand tagline — the evlog slogan. */
export const TAGLINE = 'DIGGING THROUGH LOGS IS NOT OBSERVABILITY. IT\'S HOPE'

/**
 * `evlog` wordmark — figlet "slant" font (UnJS-family aesthetic).
 * Trailing spaces stripped; every line padded to the same width.
 */
export const WORDMARK = [
  '             __           ',
  '  ___ _   __/ /___  ____ _',
  ' / _ \\ | / / / __ \\/ __ `/',
  '/  __/ |/ / / /_/ / /_/ / ',
  '\\___/|___/_/\\____/\\__, /  ',
  '                 /____/   ',
] as const

const WORDMARK_WIDTH = WORDMARK[0].length
const MIN_COLUMNS = WORDMARK_WIDTH + 8

/**
 * Vertical scanline glow across the wordmark rows — bright core, dim edges.
 * Six rows: dim → mid → bold → bold → mid → dim.
 */
const SCANLINES = [
  ['dim', 'white'],
  ['white'],
  ['bold', 'white'],
  ['bold', 'white'],
  ['white'],
  ['dim', 'white'],
] as const

/** Gradient stops: brand blue → near-black (site accent bar, L→R fade). */
const GRADIENT_FROM = [43, 90, 255] as const
const GRADIENT_TO = [8, 10, 40] as const

/**
 * Where the accent bar sits inside its terminal row — the only sub-cell
 * ("pixel") control terminals give us:
 *
 * | Glyph | Position in cell      | Air above text |
 * | ----- | --------------------- | -------------- |
 * | `▀`   | top half              | none (glued)   |
 * | `━`   | optical middle        | some           |
 * | `▄`   | lower half (default)  | half cell      |
 * | `▂`   | lower quarter         | more           |
 * | `▁`   | baseline              | most           |
 */
export const GRADIENT_GLYPH = '▄'

/** Accent bar width under command titles. */
export const HEADER_GRADIENT_WIDTH = 28

/**
 * Horizontal rule fading blue → dark, like the site's accent bar.
 * Truecolor per-cell; plain blue on a terminal without truecolor, plain dashes
 * when colors are off.
 *
 * @param glyph - Override {@link GRADIENT_GLYPH} to tune vertical air above the bar.
 */
export function gradientRule(
  ctx: Pick<CliContext, 'color' | 'truecolor'>,
  width: number,
  glyph: string = GRADIENT_GLYPH,
): string {
  if (!ctx.color) return '─'.repeat(width)
  if (!ctx.truecolor) return createStyle(ctx).paint('blue', glyph.repeat(width))
  let out = ''
  for (let i = 0; i < width; i++) {
    const t = width === 1 ? 1 : i / (width - 1)
    const r = Math.round(GRADIENT_FROM[0] + (GRADIENT_TO[0] - GRADIENT_FROM[0]) * t)
    const g = Math.round(GRADIENT_FROM[1] + (GRADIENT_TO[1] - GRADIENT_FROM[1]) * t)
    const b = Math.round(GRADIENT_FROM[2] + (GRADIENT_TO[2] - GRADIENT_FROM[2]) * t)
    out += `\x1B[38;2;${r};${g};${b}m${glyph}`
  }
  return `${out}\x1B[0m`
}

/**
 * Whether the branded command header should print.
 *
 * Disabled when:
 * - `--json` (machine output)
 * - `--no-header` (flag on the command or anywhere on argv)
 * - `EVLOG_CLI_NO_HEADER=1` or `EVLOG_CLI_HEADER=0`
 */
export function wantsHeader(
  ctx: Pick<CliContext, 'env'>,
  args?: { json?: boolean, noHeader?: boolean },
  argv: readonly string[] = process.argv,
): boolean {
  if (args?.json) return false
  if (args?.noHeader) return false
  if (ctx.env.EVLOG_CLI_NO_HEADER === '1') return false
  if (ctx.env.EVLOG_CLI_HEADER === '0') return false
  if (argv.includes('--no-header')) return false
  return true
}

/**
 * Branded command header used by every leaf command:
 *
 * ```
 *     evlog doctor v0.0.0
 *     ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 * ```
 *
 * Vertical air between title and bar is controlled by {@link GRADIENT_GLYPH}
 * (sub-cell), not by blank rows. Skip via {@link wantsHeader}.
 */
export function formatCommandHeader(
  ctx: CliContext,
  options: { command: string, version?: string },
): string {
  const { paint } = createStyle(ctx)
  const version = options.version ?? VERSION
  return [
    '',
    `${paint('bold', 'evlog')} ${paint(['cyan', 'bold'], options.command)} ${paint('dim', `v${version}`)}`,
    `${gradientRule(ctx, HEADER_GRADIENT_WIDTH)}`,
    '',
  ].join('\n')
}

/**
 * Full branded banner: figlet wordmark with scanline glow, gradient accent
 * rule, and a single dim meta line (tagline · version · docs link).
 *
 * Falls back to a compact one-liner when colors are off or the terminal is
 * too narrow for the art.
 */
export function formatBanner(ctx: CliContext, version: string): string {
  const { paint, link } = createStyle(ctx)

  if (!ctx.color || ctx.columns < MIN_COLUMNS) {
    return `  ${paint('bold', 'evlog')} ${paint('dim', `v${version} — digging through logs is not observability ·`)} ${link(DOCS_URL, DOCS_LABEL)}\n`
  }

  const art = WORDMARK.map((row, i) => `  ${paint([...SCANLINES[i]!], row)}`)
  const rule = `  ${gradientRule(ctx, WORDMARK_WIDTH)}`
  const slogan = `  ${paint('dim', TAGLINE)}`
  const meta = `  ${paint('dim', `v${version} · `)}${link(DOCS_URL, DOCS_LABEL)}`

  return `${art.join('\n')}\n\n${rule}\n\n${slogan}\n${meta}\n`
}
