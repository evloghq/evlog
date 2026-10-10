import type { CliContext } from '../../core/context'
import { gradientRule, HEADER_GRADIENT_WIDTH } from '../../core/brand'
import { DOCS_URL, createStyle } from '../../core/output'
import type { Style, StyleCode } from '../../core/output'
import { getFramework } from '../frameworks'
import type { BaselineComparison } from './baseline'
import { hasRegressed } from './baseline'
import { countSuppressed } from './directives'
import { isInfrastructureRoute } from './exemptions'
import { REQUIREMENTS, getRule } from './rules/index'
import type { FixSlot, SuggestContext } from './rules/index'
import type { ProjectFacts } from './project-facts'
import { classifyRouteObservability, scoreGlobal } from './score'
import type { CheckId, CheckResult, Framework, RouteEntry, ScanResult } from './types'
import { indent } from './utils'
import { MAP_FILE_NAME } from './write'

/* ── measuring text that contains ANSI ─────────────────────────────────── */

const ANSI = /\u001B\[[0-9;]*m|\u001B\]8;;[^\u0007]*\u0007/g

function visibleLength(text: string): number {
  return text.replace(ANSI, '').length
}

function pad(text: string, width: number): string {
  const missing = width - visibleLength(text)
  return missing > 0 ? text + ' '.repeat(missing) : text
}

function padStart(text: string, width: number): string {
  const missing = width - visibleLength(text)
  return missing > 0 ? ' '.repeat(missing) + text : text
}

/* ── shared derivations ────────────────────────────────────────────────── */

function scoreColor(score: number): StyleCode {
  if (score >= 90) return 'green'
  if (score >= 70) return 'cyan'
  if (score >= 50) return 'yellow'
  return 'red'
}

function methodColor(method: string | null): StyleCode {
  switch (method) {
    case 'GET': return 'blue'
    case 'POST': return 'green'
    case 'PUT':
    case 'PATCH': return 'yellow'
    case 'DELETE': return 'red'
    default: return 'dim'
  }
}

/** Short label for entry points that have no HTTP method. */
const KIND_SHORT: Record<string, string> = {
  /* A catch-all route answers any verb, which is what the column should say. */
  'api': 'ANY',
  'page': 'PAGE',
  'middleware': 'MID',
  'server-action': 'ACT',
  'cron': 'CRON',
  'websocket': 'WS',
}

function methodOf(route: RouteEntry): string {
  return route.method ?? KIND_SHORT[route.kind] ?? route.kind.toUpperCase().slice(0, 6)
}

function failedChecks(route: RouteEntry): CheckId[] {
  return (Object.entries(route.checks) as [CheckId, CheckResult][])
    .filter(([, check]) => check.status === 'fail')
    .map(([id]) => id)
}

function hasGaps(route: RouteEntry): boolean {
  return failedChecks(route).length > 0
}

function miniBar(style: ReportStyle, score: number, width = 10): string {
  const filled = Math.round((score / 100) * width)
  return style.paint(scoreColor(score), '▰'.repeat(filled))
    + style.paint('dim', '▱'.repeat(width - filled))
}

const DIGITS: Record<string, readonly string[]> = {
  0: ['█▀█', '█ █', '▀▀▀'],
  1: [' ▄█', '  █', '  ▀'],
  2: ['▀▀█', '█▀▀', '▀▀▀'],
  3: ['▀▀█', ' ▀█', '▀▀▀'],
  4: ['█ █', '▀▀█', '  ▀'],
  5: ['█▀▀', '▀▀█', '▀▀▀'],
  6: ['█▀▀', '█▀█', '▀▀▀'],
  7: ['▀▀█', '  █', '  ▀'],
  8: ['█▀█', '█▀█', '▀▀▀'],
  9: ['█▀█', '▀▀█', '▀▀▀'],
}

/** The score as three rows of block art. */
function bigDigits(value: number): string[] {
  const chars = String(value).split('')
  return [0, 1, 2].map(row => chars.map(char => DIGITS[char]![row]).join(' '))
}

function sensitivityBadges(style: ReportStyle, route: RouteEntry): string {
  const reasons = route.sensitivity.reasons.join(' ')
  const parts: string[] = []
  if (reasons.includes('money:')) parts.push(style.paint('magenta', '$'))
  if (reasons.includes('auth:')) parts.push(style.paint('cyan', 'A'))
  if (reasons.includes('pii:')) parts.push(style.paint('yellow', '@'))
  return parts.join('')
}

/**
 * `POST   /api/checkout` — the method column, then what was matched.
 *
 * Entry points without a path of their own say what they are instead: a
 * middleware rendered as `MID *` told the reader nothing.
 */
function entryLabel(style: ReportStyle, route: RouteEntry): string {
  const method = style.paint(methodColor(route.method), pad(methodOf(route), 6))
  return `${method} ${matchedTarget(route)}`
}

/** What this entry point matches, for kinds whose "path" is a wildcard. */
function matchedTarget(route: RouteEntry): string {
  if (route.kind === 'middleware') return route.path === '*' ? 'every request' : route.path
  if (route.kind === 'cron') return `job ${route.path}`
  return route.path
}

/** What kind of thing this entry point is, in plain words. */
function entryKindText(route: RouteEntry): string {
  switch (route.kind) {
    case 'api': return `${route.method ?? 'ANY'} ${route.path} — server handler`
    case 'page': return 'page that fetches data server-side'
    case 'middleware': return 'middleware — runs on every matching request'
    case 'cron': return 'scheduled job'
    case 'server-action': return 'server action invoked from the client'
    case 'websocket': return 'websocket handler'
  }
}

function displayName(route: RouteEntry): string {
  if (route.kind === 'middleware') return 'middleware'
  if (route.kind === 'cron') return `job ${route.path}`
  return route.path
}

/**
 * Narrowest width the report lays out for, and the widest it spreads to.
 *
 * The floor is a contract: below 80 columns a sentence like "missing audit
 * trails" cannot be shown next to a score without being cut mid-word, so the
 * report keeps laying out for 80 and lets the terminal wrap rather than
 * mangling its own text. The ceiling stops a maximised window from stretching a
 * route list into one unreadable line.
 */
export const MIN_WIDTH = 80
const MAX_WIDTH = 110

interface ReportStyle extends Style {
  doc: (path: string) => string
  /** Columns the report may fill, clamped to a readable range. */
  width: number
}

/**
 * The style kit plus a documentation link that reads well either way.
 *
 * `Style.link` falls back to `label (url)` without colors, which would print
 * the same address twice here since the label *is* the address. Plain mode gets
 * the bare URL instead.
 */
function createReportStyle(ctx: CliContext): ReportStyle {
  const style = createStyle(ctx)
  return {
    ...style,
    /* Both modes show the same label so a line measured in one fits in the
       other: spelling out `https://` only in plain mode made the evidence line
       overflow 80 columns exactly where colour was unavailable, which is CI. */
    doc: path => ctx.color ? style.link(`${DOCS_URL}${path}`, `evlog.dev${path}`) : `evlog.dev${path}`,
    width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ctx.columns)),
  }
}

function ruleDocs(id: CheckId): string {
  return getRule(id)?.docs ?? '/cli/rules'
}

function ruleExpects(id: CheckId): string {
  return getRule(id)?.expects ?? id
}

/**
 * Why an entry point is worth fixing first, as a sentence.
 *
 * Deliberately human: "moves money with no audit trail" tells you what is at
 * stake, where "audit: fail" only tells you a box is unticked.
 */
function priorityReason(route: RouteEntry): { sentence: string, doc: string } {
  const reasons = route.sensitivity.reasons.join(' ')
  const failed = failedChecks(route)

  if (reasons.includes('money:') && failed.includes('audit')) {
    return { sentence: 'moves money with no audit trail', doc: ruleDocs('audit') }
  }
  if (reasons.includes('money:') && failed.includes('wide-event')) {
    return { sentence: 'moves money and logs nothing — invisible in production', doc: ruleDocs('wide-event') }
  }
  if (reasons.includes('auth:') && failed.includes('wide-event')) {
    return { sentence: 'touches auth and logs nothing', doc: ruleDocs('wide-event') }
  }
  if (failed.includes('wide-event')) {
    return { sentence: 'when it breaks, the event will not say why', doc: ruleDocs('wide-event') }
  }
  if (failed.includes('structured-errors')) {
    return { sentence: 'throws plain errors with no why or fix', doc: ruleDocs('structured-errors') }
  }
  if (failed.includes('page-error-handling')) {
    return { sentence: 'swallows fetch errors — users see a blank page', doc: ruleDocs('page-error-handling') }
  }
  const [first] = failed
  return first
    ? { sentence: `missing ${ruleExpects(first)}`, doc: ruleDocs(first) }
    : { sentence: 'has gaps', doc: '/cli/rules' }
}

/** Entry points with gaps, worst first, sensitive ones ahead of the rest: the FIX FIRST order. */
export function prioritize(routes: RouteEntry[]): RouteEntry[] {
  return [...routes]
    .filter(hasGaps)
    .sort((a, b) => {
      const sensitiveA = a.sensitivity.level !== 'none' ? 1 : 0
      const sensitiveB = b.sensitivity.level !== 'none' ? 1 : 0
      if (sensitiveA !== sensitiveB) return sensitiveB - sensitiveA
      return a.score - b.score
    })
}

/* ── the default report ────────────────────────────────────────────────── */

interface CoverageArea {
  label: string
  routes: RouteEntry[]
  meaning: (routes: RouteEntry[], gaps: number) => string
}

function coverageAreas(active: RouteEntry[]): CoverageArea[] {
  return [
    {
      label: 'API handlers',
      routes: active.filter(route => route.kind === 'api'),
      meaning: (routes, gaps) => gaps === 0 ? 'every handler covered' : `${gaps} of ${routes.length} have gaps`,
    },
    {
      label: 'Pages',
      routes: active.filter(route => route.kind === 'page'),
      meaning: (_routes, gaps) => gaps === 0
        ? 'data fetching covered'
        : `${gaps} swallow${gaps === 1 ? 's' : ''} fetch errors`,
    },
    {
      label: 'Middleware & jobs',
      routes: active.filter(route => !['api', 'page'].includes(route.kind)),
      meaning: (_routes, gaps) => gaps === 0 ? 'fully covered' : 'run without any logging',
    },
    {
      label: 'Money & auth',
      routes: active.filter(route => route.sensitivity.level !== 'none'),
      meaning: (_routes, gaps) => gaps === 0 ? 'fully traced & audited' : 'missing audit trails',
    },
  ]
}

/**
 * One glyph per entry point, downsampled to `width`.
 *
 * A bar that grows with the project is not a bar: at 2000 entry points this was
 * a single 2000-character line that wrapped over the whole report. Bucketing
 * keeps the shape readable at any size, and since the entry points are sorted
 * worst-first each bucket is represented by its worst one — the reader is
 * looking for where the trouble is, not for an average.
 */
function skylineBar(style: ReportStyle, routes: readonly RouteEntry[], width: number): string {
  const sorted = [...routes].sort((a, b) => a.score - b.score)
  if (sorted.length === 0 || width <= 0) return ''

  const buckets = Math.min(width, sorted.length)
  const perBucket = sorted.length / buckets
  const glyphs: string[] = []

  for (let index = 0; index < buckets; index++) {
    const route = sorted[Math.floor(index * perBucket)]!
    if (classifyRouteObservability(route) === 'exempt') {
      glyphs.push(style.paint('dim', '▁'))
      continue
    }
    const height = route.score >= 90
      ? '█'
      : route.score >= 70 ? '▆' : route.score >= 50 ? '▄' : route.score >= 30 ? '▃' : '▂'
    glyphs.push(style.paint(scoreColor(route.score), height))
  }

  return glyphs.join('')
}

/** Width the headline spends on the block digits, the gauge, and their gutters. */
const HEADLINE_GAUGE_WIDTH = 22

/** Room kept for the ` +12` tail on a clipped list. */
const MORE_WIDTH = 5

/** The score, as a headline: block digits, gauge, grade, per-entry skyline. */
function scoreHeadline(style: ReportStyle, result: ScanResult): string[] {
  const { map, grade } = result
  const color = scoreColor(map.score)
  const digits = bigDigits(map.score)

  const gaugeFilled = Math.round((map.score / 100) * 20)
  const gauge = style.paint(color, '▰'.repeat(gaugeFilled))
    + style.paint('dim', '▱'.repeat(20 - gaugeFilled))

  /* The skyline shares its row with the digits and the gauge, so it gets what
     they leave rather than a width of its own. */
  const prefixWidth = visibleLength(digits[0] ?? '') + 3 + HEADLINE_GAUGE_WIDTH + 2

  const side = [
    style.paint('dim', `${map.projectName} · ${getFramework(map.framework).label}`),
    style.paint('dim', `${map.routes.length} entry points scanned`),
    skylineBar(style, map.routes, style.width - prefixWidth),
  ]

  return digits.map((digitRow, index) => {
    const middle = index === 0
      ? style.paint('dim', 'score /100')
      : index === 1 ? gauge : style.paint(color, grade.replace('-', ' '))
    return `${style.paint([color, 'bold'], digitRow)}   ${pad(middle, HEADLINE_GAUGE_WIDTH)}  ${side[index] ?? ''}`
  })
}

/**
 * As many items as fit in `budget`, plus how many were left out.
 *
 * Route lists used to keep a fixed three or four items whatever the terminal, so
 * a narrow window wrapped and a wide one wasted the space it had. Items are
 * measured unpainted; the caller paints what comes back.
 */
function fitItems(items: readonly string[], separator: string, budget: number): { shown: string[], hidden: number } {
  const shown: string[] = []
  let used = 0

  for (const item of items) {
    const cost = item.length + (shown.length > 0 ? separator.length : 0)
    /* One item always shows, even when it alone overflows: a truncated name
       still tells the reader where to look, an empty list does not. */
    if (shown.length > 0 && used + cost > budget) break
    shown.push(item)
    used += cost
  }

  return { shown, hidden: items.length - shown.length }
}

/**
 * The report `evlog map` prints.
 *
 * Ordered the way it is meant to be read: the score, where the gaps are, the
 * three things to fix first, then everything else grouped so it is a decision
 * rather than a list. The branded header is owned by `defineEvlogCommand`, so
 * it is deliberately absent here.
 */
export function formatMapReport(
  ctx: CliContext,
  result: ScanResult,
  options: { mapPath?: string | null } = {},
): string {
  const style = createReportStyle(ctx)
  const { paint } = style
  const { map } = result
  const lines: string[] = []

  lines.push(...scoreHeadline(style, result))
  lines.push('')

  const active = map.routes.filter(route => classifyRouteObservability(route) !== 'exempt')

  lines.push(paint('dim', 'COVERAGE'))
  for (const area of coverageAreas(active)) {
    if (area.routes.length === 0) continue
    const areaScore = Math.round(area.routes.reduce((sum, route) => sum + route.score, 0) / area.routes.length)
    const gaps = area.routes.filter(hasGaps).length
    const glyph = area.label === 'Money & auth' && areaScore < 70
      ? paint('red', '⚠')
      : paint(scoreColor(areaScore), '●')
    lines.push([
      glyph,
      pad(area.label, 18),
      miniBar(style, areaScore),
      padStart(paint(scoreColor(areaScore), String(areaScore)), 4),
      ` ${paint('dim', area.meaning(area.routes, gaps))}`,
    ].join(' '))
  }
  lines.push('')

  const priorities = prioritize(active).slice(0, 3)
  if (priorities.length > 0) {
    lines.push(paint('dim', 'FIX FIRST'))
    priorities.forEach((route, index) => {
      const { sentence, doc } = priorityReason(route)
      const line = route.handler?.line ?? 1
      lines.push([
        paint('dim', `${index + 1}.`),
        entryLabel(style, route),
        sensitivityBadges(style, route),
        paint('dim', `— ${sentence}`),
      ].filter(part => part.length > 0).join(' '))
      lines.push(`   ${paint('dim', `${route.file}:${line} ·`)} ${style.doc(doc)}`)
    })
    lines.push('')
  }

  const rest = active.filter(route => !priorities.includes(route) && hasGaps(route))
  if (rest.length > 0) {
    /* Grouped by which gaps they share: one decision per group beats one line
       per route saying almost the same thing. */
    const byGapSignature = new Map<string, RouteEntry[]>()
    for (const route of rest) {
      const signature = failedChecks(route).map(ruleExpects).join(' + ')
      const group = byGapSignature.get(signature)
      if (group) group.push(route)
      else byGapSignature.set(signature, [route])
    }

    lines.push(paint('dim', 'THEN'))
    const groups = [...byGapSignature].sort((a, b) => b[1].length - a[1].length)
    for (const [signature, routes] of groups) {
      const lead = `· add ${signature} to `
      const { shown, hidden } = fitItems(routes.map(displayName), ', ', style.width - lead.length - MORE_WIDTH)
      const names = shown.join(paint('dim', ', '))
      const more = hidden > 0 ? paint('dim', ` +${hidden}`) : ''
      lines.push(`${paint('yellow', '·')} ${paint('dim', `add ${signature} to`)} ${names}${more}`)
    }
    lines.push('')
  }

  lines.push(...suggestionSection(style, result))

  /* An entry point with a waived finding is not "solid": something was found and
     set aside. It is accounted for by the disabled count instead. */
  const solid = active.filter(route => !hasGaps(route) && countSuppressed(route) === 0)
  if (solid.length > 0) {
    const lead = '✓ Already solid: '
    const { shown, hidden } = fitItems(solid.map(displayName), ' · ', style.width - lead.length - MORE_WIDTH)
    const more = hidden > 0 ? ` +${hidden}` : ''
    lines.push(`${paint('green', '✓')} ${paint('dim', `Already solid: ${shown.join(' · ')}${more}`)}`)
  }

  const projected = scoreGlobal(
    map.routes.map(route => priorities.includes(route) ? { ...route, score: 100 } : route),
  )
  if (projected > map.score) {
    lines.push(`${paint('green', '▲')} ${paint('bold', `${map.score} → ${projected}`)} ${paint('dim', `by fixing the ${priorities.length} above`)}`)
  }

  lines.push(...suppressedLine(style, result))

  lines.push('')
  lines.push(gradientRule(ctx, HEADER_GRADIENT_WIDTH))
  const written = options.mapPath ? 'evlog.map.json updated · ' : ''
  lines.push(`${paint('dim', `${written}how this score works →`)} ${style.doc('/cli/scoring')}`)
  lines.push(...hintLines(style))

  return lines.join('\n')
}

/**
 * What the project turned off, when it turned anything off.
 *
 * A score that is partly the result of disabled checks has to say so, or the
 * escape hatch quietly becomes a way to score 100 on an app that logs nothing.
 */
function suppressedLine(style: ReportStyle, result: ScanResult): string[] {
  const count = result.summary.suppressedChecks
  if (count === 0) return []

  const files = result.map.routes.filter(route => countSuppressed(route) > 0).length
  const checks = count === 1 ? '1 check' : `${count} checks`
  const entries = files === 1 ? '1 entry point' : `${files} entry points`
  return [`${style.paint('dim', '○')} ${style.paint('dim', `${checks} disabled by comment in ${entries}`)}`]
}

/** What to run next, on one line when it fits and stacked when it does not. */
function hintLines(style: ReportStyle): string[] {
  const hints = ['evlog map --all every entry point', 'evlog map <file> inspect one', '--min-score 80 CI gate']
  const rows: string[][] = [[]]
  let used = 2

  for (const hint of hints) {
    const row = rows[rows.length - 1]!
    if (row.length > 0 && used + hint.length + 3 > style.width) {
      rows.push([hint])
      used = 2 + hint.length
      continue
    }
    row.push(hint)
    used += hint.length + (row.length > 1 ? 3 : 0)
  }

  return rows.map((row, index) => `${style.paint('dim', index === 0 ? '▸' : ' ')} ${style.paint('dim', row.join(' · '))}`)
}

/**
 * Features the project already uses that some entry points do not.
 *
 * Rendered as an invitation, never as a failure: no red, no ✗, and an explicit
 * note that the score is untouched. Suggesting a feature is only welcome when
 * it cannot be mistaken for an accusation.
 */
function suggestionSection(style: ReportStyle, result: ScanResult): string[] {
  const { paint } = style
  const byRule = new Map<CheckId, { count: number, first: string }>()

  for (const route of result.map.routes) {
    for (const [id, check] of Object.entries(route.suggestions) as [CheckId, CheckResult][]) {
      if (check.status !== 'fail') continue
      const where = `${route.file}:${check.evidence?.line ?? 1}`
      const entry = byRule.get(id)
      if (entry) entry.count++
      else byRule.set(id, { count: 1, first: where })
    }
  }

  if (byRule.size === 0 && result.suggestions.length === 0) return []

  const lines = [
    paint('dim', 'GOING FURTHER'),
    paint('dim', 'you already use these — your app could get more out of them'),
  ]

  /* Project-wide first: it is one edit, so it is the cheapest thing on the list. */
  for (const suggestion of result.suggestions) {
    lines.push(`${paint('cyan', '+')} ${paint('dim', suggestion.message)}`)
    const where = suggestion.evidence ? `${suggestion.evidence.file}:${suggestion.evidence.line} · ` : ''
    lines.push(`   ${paint('dim', `one-time setup · ${where}`)}${style.doc(ruleDocs(suggestion.id))}`)
  }

  for (const [id, entry] of byRule) {
    const question = getRule(id)?.question ?? id
    const where = entry.count > 1 ? `${entry.count} entry points` : '1 entry point'
    lines.push(`${paint('cyan', '+')} ${paint('dim', question)} ${paint('dim', `— ${where}`)}`)
    lines.push(`   ${paint('dim', `${entry.first} ·`)} ${style.doc(ruleDocs(id))}`)
  }

  lines.push(paint('dim', 'Suggestions never change the score.'))
  lines.push('')
  return lines
}

/* ── --all: every entry point as a check matrix ────────────────────────── */

const MATRIX_CELL = 6

/** Below this a file name says nothing, so the matrix overflows instead. */
const MIN_LABEL_WIDTH = 18

/**
 * Keep the end of a path that is too long for its column.
 *
 * The tail is what identifies an entry point — `…/invoices/[id]/route.ts` is
 * readable, `app/(dashboard)/settin…` is not.
 */
function clipStart(text: string, width: number): string {
  return text.length <= width ? text : `…${text.slice(text.length - width + 1)}`
}

function matrixColumns(): { id: CheckId, label: string }[] {
  return [
    { id: 'wide-event', label: 'log' },
    { id: 'context', label: 'ctx' },
    { id: 'structured-errors', label: 'err' },
    { id: 'audit', label: 'audit' },
    { id: 'error-handling', label: 'catch' },
    { id: 'page-error-handling', label: 'fetch' },
  ]
}

/**
 * Every entry point, grouped by directory, with one dot per rule.
 *
 * The column headers are positioned from the same measurements as the rows, so
 * a dot is always under its own header no matter how long the file names are.
 */
export function formatMapMatrix(ctx: CliContext, result: ScanResult): string {
  const style = createReportStyle(ctx)
  const { paint } = style
  const { map } = result
  const columns = matrixColumns()
  const lines: string[] = []

  lines.push([
    paint('dim', `${map.projectName} · ${getFramework(map.framework).label} ·`),
    `${paint([scoreColor(map.score), 'bold'], String(map.score))}${paint('dim', '/100')}`,
    paint('dim', `· ${map.routes.length} entry points, worst first`),
  ].join(' '))
  lines.push('')

  /* Root-level entry points (Next's `middleware.ts`) group under `./` rather
     than becoming a directory of their own with a nameless row in it. */
  const groupOf = (route: RouteEntry): string => route.file.includes('/') ? route.file.split('/')[0]! : '.'
  const labelOf = (route: RouteEntry): string => route.file.includes('/')
    ? route.file.split('/').slice(1).join('/')
    : route.file

  const byDirectory = new Map<string, RouteEntry[]>()
  for (const route of map.routes) {
    const group = byDirectory.get(groupOf(route))
    if (group) group.push(route)
    else byDirectory.set(groupOf(route), [route])
  }
  /* branch + space + label + bar + space + score + space + badge + space */
  const fixedWidth = 2 + 1 + 10 + 1 + 3 + 1 + 2 + 1 + columns.length * MATRIX_CELL
  const longest = Math.max(...map.routes.map(route => labelOf(route).length)) + 2
  const labelWidth = Math.max(MIN_LABEL_WIDTH, Math.min(longest, style.width - fixedWidth))
  const prefixWidth = fixedWidth - columns.length * MATRIX_CELL + labelWidth

  lines.push(`${' '.repeat(prefixWidth)}${columns.map(col => pad(paint('dim', col.label), MATRIX_CELL)).join('')}`)

  for (const directory of [...byDirectory.keys()].sort()) {
    lines.push(paint('blue', `${directory}/`))
    const routes = byDirectory.get(directory)!.sort((a, b) => a.score - b.score)
    routes.forEach((route, index) => {
      const branch = paint('dim', index === routes.length - 1 ? '└─' : '├─')
      const label = clipStart(labelOf(route), labelWidth - 2)

      if (classifyRouteObservability(route) === 'exempt') {
        const why = isInfrastructureRoute(route) ? 'evlog internals' : 'nothing to instrument'
        lines.push(`${branch} ${pad(paint('dim', label), labelWidth)}${paint('dim', `exempt — ${why}`)}`)
        return
      }

      const cells = columns.map((column) => {
        const check = route.checks[column.id]
        if (check?.suppressed) return pad(paint('dim', '○'), MATRIX_CELL)
        if (!check || check.status === 'n/a') return pad(paint('dim', '·'), MATRIX_CELL)
        return pad(check.status === 'pass' ? paint('green', '●') : paint('red', '●'), MATRIX_CELL)
      }).join('')

      const prefix = [
        branch,
        pad(label, labelWidth - 1),
        miniBar(style, route.score),
        padStart(paint(scoreColor(route.score), String(route.score)), 3),
        pad(sensitivityBadges(style, route), 2),
      ].join(' ')
      lines.push(`${prefix} ${cells}`)
    })
  }

  lines.push('')
  lines.push([
    `${paint('green', '●')} ${paint('dim', 'covered')}`,
    `${paint('red', '●')} ${paint('dim', 'gap')}`,
    paint('dim', '·  not applicable'),
    ...(result.summary.suppressedChecks > 0 ? [paint('dim', '○  disabled')] : []),
    `${paint('magenta', '$')}${paint('dim', ' money')}`,
    `${paint('cyan', 'A')}${paint('dim', ' auth')}`,
    `${paint('yellow', '@')}${paint('dim', ' pii')}`,
  ].join('   '))
  lines.push(`${paint('dim', 'what each column checks →')} ${style.doc('/cli/rules')}`)

  return lines.join('\n')
}

/* ── inspecting one entry point ───────────────────────────────────────── */

/** How each rule reads when it passes and when it fails, in the deep dive. */
const EXPLAIN: Partial<Record<CheckId, { fail: string, pass: string }>> = {
  'wide-event': { fail: 'no logger — nothing is added to the request event', pass: 'wide event emitted per request' },
  'context': { fail: 'nothing attached — the event carries no business context', pass: 'context attached with log.set()' },
  'structured-errors': { fail: 'throws plain errors — no why, no fix', pass: 'errors carry why and fix' },
  'audit': { fail: 'sensitive action with no audit trail', pass: 'audit trail present' },
  'error-handling': { fail: 'exceptions escape unlogged', pass: 'failures are caught and logged' },
  'page-error-handling': { fail: 'fetch errors are swallowed silently', pass: 'fetch errors are surfaced' },
}

/**
 * The fix each failing rule asks for, in the order the rules are registered.
 *
 * Rules are the single source here on purpose: this renderer used to spell the
 * fixes out itself, which is how a page ended up shown an empty event handler
 * and how every route was told to audit `payment.captured`.
 */
function fixesInSlot(slot: FixSlot, route: RouteEntry, context: SuggestContext): string[] {
  const failed = new Set(failedChecks(route))
  return REQUIREMENTS
    .filter(rule => failed.has(rule.id) && (rule.fixSlot ?? 'body') === slot)
    .flatMap(rule => rule.suggest?.(context) ?? [])
}

/** The evlog calls an entry point is missing, in the host framework's shape. */
function suggestedShape(route: RouteEntry, framework: Framework, project: ProjectFacts): string[] {
  const context: SuggestContext = { target: route, framework, project }
  const slot = (name: FixSlot): string[] => fixesInSlot(name, route, context)

  const guard = slot('guard')
  const exit = slot('exit')
  const body = [...slot('setup')]

  if (guard.length > 0) {
    body.push(
      'try {',
      ...['// …your existing work', ...slot('body')].map(line => indent(1, line)),
      `} ${guard[0]}`,
      ...guard.slice(1),
      ...(exit.length > 0 ? exit : ['throw error']).map(line => indent(1, line)),
      '}',
    )
  } else {
    body.push(...slot('body'), ...exit)
  }

  if (body.length === 0) return []
  /* A page fix lives inline in the component, so wrapping it in a server
     handler skeleton would suggest moving code that should not move. */
  if (route.kind === 'page') return body

  return getFramework(framework).shape.handler(route, body)
}

/**
 * A query as the scan knows it.
 *
 * Shells complete `./server/api/foo.ts`, the map stores `server/api/foo.ts`;
 * both the lookup and the suggestions have to strip the prefix, or a typo'd
 * path is answered with "no entry point matches" and no suggestions at all.
 */
function normalizeQuery(query: string): string {
  return query.replace(/^\.\//, '')
}

/** Find an entry point by route path or by file path. */
export function findEntryPoint(result: ScanResult, query: string): RouteEntry | undefined {
  const needle = normalizeQuery(query)
  return result.map.routes.find(route => route.path === needle)
    ?? result.map.routes.find(route => route.file === needle)
    ?? result.map.routes.find(route => route.file.endsWith(needle))
}

/**
 * One entry point in full: why it was scanned, why it is sensitive, every rule
 * with its verdict and its docs, and the shape the code could take.
 */
export function formatMapInspect(ctx: CliContext, result: ScanResult, route: RouteEntry): string {
  const style = createReportStyle(ctx)
  const { paint } = style
  const { framework } = result.map
  const lines: string[] = []

  lines.push([
    entryLabel(style, route),
    sensitivityBadges(style, route),
    `  ${miniBar(style, route.score)}`,
    `${paint([scoreColor(route.score), 'bold'], String(route.score))}${paint('dim', '/100')}`,
  ].filter(part => part.length > 0).join(' '))
  lines.push(paint('dim', `${route.file} · ${getFramework(framework).label}`))
  lines.push('')

  lines.push(paint('dim', 'WHY THIS FILE IS SCANNED'))
  lines.push(`${paint('blue', '▍')} ${paint('dim', entryKindText(route))}`)
  lines.push('')

  if (route.sensitivity.reasons.length > 0) {
    lines.push(paint('dim', 'FLAGGED SENSITIVE BECAUSE'))
    for (const reason of route.sensitivity.reasons) {
      lines.push(`${paint('magenta', '▍')} ${paint('dim', reason)}`)
    }
    lines.push('')
  }

  /* Waived checks stay in the list: a finding the author set aside is a decision
     worth seeing when you open this file, unlike a rule that never applied. */
  const entries = (Object.entries(route.checks) as [CheckId, CheckResult][])
    .filter(([, check]) => check.status !== 'n/a' || check.suppressed)
  if (entries.length > 0) {
    lines.push(paint('dim', 'CHECKS'))
    const width = Math.max(...entries.map(([id]) => ruleExpects(id).length)) + 2
    for (const [id, check] of entries) {
      const label = pad(ruleExpects(id), width)
      if (check.suppressed) {
        lines.push(`${paint('dim', '○')} ${label}${paint('dim', check.message ?? 'disabled')}`)
      } else if (check.status === 'pass') {
        lines.push(`${paint('green', '✓')} ${label}${paint('dim', EXPLAIN[id]?.pass ?? 'ok')}`)
      } else {
        const why = EXPLAIN[id]?.fail ?? check.message ?? 'failed'
        lines.push(`${paint('red', '✗')} ${label}${paint('dim', why)}  ${style.doc(ruleDocs(id))}`)
      }
    }
    lines.push('')
  }

  const suggestions = (Object.entries(route.suggestions) as [CheckId, CheckResult][])
    .filter(([, check]) => check.status === 'fail')
  if (suggestions.length > 0) {
    lines.push(paint('dim', 'GOING FURTHER'))
    for (const [id, check] of suggestions) {
      lines.push(`${paint('cyan', '+')} ${paint('dim', check.message ?? getRule(id)?.question ?? id)}`)
      const shape = getRule(id)?.suggest?.({ target: route, framework, project: result.project }) ?? []
      for (const codeLine of shape) {
        lines.push(`  ${paint('dim', '│')} ${paint('dim', codeLine)}`)
      }
      lines.push(`  ${style.doc(ruleDocs(id))}`)
    }
    lines.push('')
  }

  const shape = suggestedShape(route, framework, result.project)
  if (shape.length > 0) {
    lines.push(paint('dim', `SUGGESTED SHAPE — ${getFramework(framework).label}`))
    for (const codeLine of shape) {
      const [indentation] = codeLine.match(/^\s*/)!
      const text = codeLine.trim()
      const color: StyleCode = text.startsWith('//')
        ? 'dim'
        : /useLogger|log\.set|log\.audit|log\.error|createError/.test(text) ? 'green' : 'dim'
      lines.push(`${paint('dim', '│')} ${indentation}${paint(color, text)}`)
    }
    lines.push('')
    lines.push(`${paint('green', '▲')} ${paint('dim', 'fixing this entry point:')} ${paint('bold', `${route.score} → 100`)}`)
  } else {
    /* Two sentences on purpose: "nothing to fix" alone read as a contradiction
       right under a list of suggestions, and one merged sentence made the
       suggestions sound like unfinished work. Requirements are met; the rest is
       upside. */
    const disabled = countSuppressed(route)
    const checks = disabled === 1 ? '1 check is' : `${disabled} checks are`
    /* "Nothing to fix" would be a lie when the requirements were turned off
       rather than met, so a fully disabled entry point says so instead. */
    if (disabled > 0 && !entries.some(([, check]) => check.status === 'pass')) {
      lines.push(`${paint('dim', '○')} ${paint('dim', `Nothing was checked here — ${checks} disabled by comment.`)}`)
    } else {
      lines.push(`${paint('green', '✓')} ${paint('dim', 'Nothing to fix — every requirement that applies here passes.')}`)
      if (disabled > 0) {
        lines.push(`${paint('dim', '○')} ${paint('dim', `${checks} disabled by comment, listed above.`)}`)
      }
    }
    if (suggestions.length > 0) {
      const count = suggestions.length === 1 ? '1 thing' : `${suggestions.length} things`
      lines.push(`${paint('cyan', '+')} ${paint('dim', `${count} left to gain, listed above. Optional — the score is already full.`)}`)
    }
  }

  /* The escape hatch is shown next to the verdict a reader might disagree with.
     A check nobody can turn off is a check people learn to ignore, and a tool
     with a hidden escape hatch is one they stop running. */
  const failing = entries.filter(([, check]) => check.status === 'fail')
  if (failing.length > 0) {
    const [id] = failing[0]!
    lines.push('')
    lines.push(paint('dim', `○ disagree? // evlog-map-disable-next-line ${id} -- why`))
    lines.push(`  ${style.doc('/cli/rules')}`)
  }

  return lines.join('\n')
}

/**
 * Framework-detection warnings, shown above whichever view ran.
 *
 * Every view depends on the framework being right, so an ambiguous detection
 * has to be visible in all of them — not only in the default report.
 */
export function formatMapWarnings(ctx: CliContext, warnings: readonly string[]): string {
  const { paint } = createStyle(ctx)
  return warnings.map(warning => paint('yellow', `⚠ ${warning}`)).join('\n')
}

/**
 * The `--min-score` verdict, appended to whichever view ran.
 *
 * Spells out the exit code because this line is most often read in CI logs,
 * where the reader is looking for why the job went red.
 */
export function formatGate(ctx: CliContext, result: ScanResult, threshold: number, from = '--min-score'): string {
  const style = createReportStyle(ctx)
  const { paint } = style
  const { score } = result.map
  const passed = score >= threshold
  const badge = paint(['bold', passed ? 'green' : 'red'], ' GATE ')

  const verdict = passed
    ? `${paint('green', `score ${score} meets ${from} ${threshold}`)} ${paint('dim', '— exit code 0')}`
    : `${paint('red', `score ${score} is below ${from} ${threshold}`)} ${paint('dim', '— exit code 1')}`

  const lines = ['', `${badge} ${verdict}`]
  if (!passed) {
    lines.push(`${paint('dim', 'fix what is listed under FIX FIRST to pass ·')} ${style.doc('/cli/ci')}`)
  }
  return lines.join('\n')
}

/**
 * The `--baseline` verdict — what changed since the committed map.
 *
 * Reads as a diff rather than a score, because that is the question the gate
 * answers: `--min-score` asks "is this app good enough", `--baseline` asks "did
 * this pull request make it worse". The two are printed the same way on purpose;
 * both end up in the same CI log next to the same red cross.
 */
export function formatBaseline(ctx: CliContext, comparison: BaselineComparison): string {
  const style = createReportStyle(ctx)
  const { paint } = style
  const { regressions, fixed, added, removed, delta, totalDelta } = comparison
  const passed = !hasRegressed(comparison)
  const badge = paint(['bold', passed ? 'green' : 'red'], ' BASELINE ')

  /* The headline shows the two global scores, so it has to show the arithmetic
     between them — `delta` measures something narrower and would not add up. */
  const move = totalDelta === 0
    ? paint('dim', `score ${comparison.score}, unchanged`)
    : paint(totalDelta > 0 ? 'green' : 'red', `score ${comparison.baselineScore} → ${comparison.score} (${totalDelta > 0 ? '+' : ''}${totalDelta})`)

  const lines = ['', `${badge} ${move} ${paint('dim', `vs ${comparison.source.label}`)}`]

  if (regressions.length > 0) {
    lines.push('')
    lines.push(paint('dim', 'REGRESSED'))
    for (const item of regressions) {
      const label = item.method ? `${item.method} ${item.path}` : item.path
      const cause = item.to === 'suppressed'
        ? paint('yellow', `${ruleExpects(item.check)} disabled by a comment`)
        : paint('red', `${ruleExpects(item.check)} no longer passes`)
      lines.push(`${paint('red', '✗')} ${paint('bold', label)} ${paint('dim', '—')} ${cause}`)
      lines.push(`   ${paint('dim', `${item.file} ·`)} ${style.doc(ruleDocs(item.check))}`)
    }
  }

  const darkAdded = added.filter(route => route.dark)
  if (darkAdded.length > 0) {
    /* Listed, not gated: on an app that is not green yet, failing every pull
       request that adds an endpoint would make the gate something teams turn
       off. `--min-score` is the bar for new work. */
    lines.push('')
    lines.push(paint('dim', 'NEW AND DARK'))
    const lead = '⚠ '
    const names = darkAdded.map(route => route.method ? `${route.method} ${route.path}` : route.path)
    const { shown, hidden } = fitItems(names, ' · ', style.width - lead.length - MORE_WIDTH)
    const more = hidden > 0 ? ` +${hidden}` : ''
    lines.push(`${paint('yellow', '⚠')} ${paint('dim', `${shown.join(' · ')}${more} — added with no instrumentation`)}`)
  }

  if (fixed.length > 0 || removed.length > 0) {
    const parts: string[] = []
    if (fixed.length > 0) parts.push(`${fixed.length} check${fixed.length > 1 ? 's' : ''} fixed`)
    if (removed.length > 0) parts.push(`${removed.length} entry point${removed.length > 1 ? 's' : ''} gone`)
    lines.push(`${paint('green', '✓')} ${paint('dim', parts.join(' · '))}`)
  }

  lines.push('')
  if (passed) {
    lines.push(`${paint('green', 'no regression')} ${paint('dim', '— exit code 0')}`)
  } else {
    /* `delta`, not `totalDelta`: this sentence explains the exit code, and what
       gates is the movement on the entry points that already existed. */
    const counted = `${regressions.length} regression${regressions.length === 1 ? '' : 's'}${delta < 0 ? ` and a ${-delta} point drop on existing entry points` : ''}`
    lines.push(`${paint('red', counted)} ${paint('dim', '— exit code 1 ·')} ${style.doc('/cli/ci')}`)
    lines.push(paint('dim', `${MAP_FILE_NAME} was not rewritten — fix the regression, or re-run without --baseline to accept it`))
  }

  return lines.join('\n')
}

/** Shown when `evlog map <file>` matches nothing the scan found. */
export function formatEntryPointNotFound(ctx: CliContext, result: ScanResult, query: string): string {
  const { paint } = createStyle(ctx)
  const needle = normalizeQuery(query)
  const nearby = result.map.routes
    .filter(route => route.file.includes(needle) || route.path.includes(needle))
    .slice(0, 5)

  const lines = [paint('yellow', `No entry point matches ${query}`)]
  if (nearby.length > 0) {
    lines.push(paint('dim', 'Did you mean:'))
    for (const route of nearby) lines.push(paint('dim', `  ${route.path} — ${route.file}`))
  } else {
    lines.push(paint('dim', `${result.map.routes.length} entry points were scanned — run evlog map --all to list them.`))
  }
  return lines.join('\n')
}
