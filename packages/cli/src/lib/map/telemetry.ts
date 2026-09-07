import { telemetry } from '@evlog/telemetry'
import type { BaselineComparison } from './baseline'
import { hasRegressed } from './baseline'
import { RULES } from './rules/index'
import { classifyRouteObservability } from './score'
import { sensitivityLabel } from './sensitivity'
import type { CheckId, Framework, Grade, RouteEntry, RouteKind, ScanResult } from './types'

/**
 * What `evlog map` reports about a scan.
 *
 * Counts, grades and rule ids — never a route path, a file name or a project
 * name. Rule ids are this CLI's own closed set and are already public, so they
 * can travel as values; everything read out of the user's source stays a count.
 *
 * The distribution these fields produce is what calibrates the tool itself: the
 * 90/70/50 grade bands are a guess until real scores land against them, a rule
 * suppressed on most of the entry points it fires on is a bad rule rather than
 * bad code, and the kind split says whether the next rule should be about
 * scheduled jobs or server actions.
 */
const PREFIX = 'map'

const FRAMEWORKS: readonly Framework[] = ['nuxt', 'nitro', 'next', 'tanstack-start', 'hono', 'express', 'fastify', 'elysia']
const GRADES: readonly Grade[] = ['excellent', 'good', 'needs-work', 'at-risk']

/** Entry-point kinds the map can scan, a closed set, in scan order. */
const KINDS: readonly RouteKind[] = ['api', 'page', 'middleware', 'server-action', 'cron', 'websocket']

/** Sensitivity labels the classifier can assign, in precedence order. */
const SENSITIVITIES = ['money', 'auth', 'pii'] as const
type SensitivityLabel = typeof SENSITIVITIES[number]

/** Which gate the run asked for — `--min-score`, `--baseline`, both, neither. */
const GATES = ['none', 'min-score', 'baseline', 'both'] as const
export type MapGate = typeof GATES[number]

/** Which of the three renderers the run asked for. */
const VIEWS = ['summary', 'all', 'inspect'] as const
export type MapView = typeof VIEWS[number]

/** String fields, with the exact set of values each may take. */
export const MAP_TELEMETRY_FIELDS = {
  mapFramework: FRAMEWORKS,
  mapGrade: GRADES,
  mapGate: GATES,
  mapView: VIEWS,
} as const satisfies Record<string, readonly string[]>

/** `wide-event` → `WideEvent`. */
function pascal(id: string): string {
  return id.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')
}

/** Field name for a per-rule tally: `wide-event` → `mapFailWideEvent`. */
export function ruleField(group: 'Fail' | 'Suppressed', id: CheckId): string {
  return `${PREFIX}${group}${pascal(id)}`
}

/** Field name for a per-kind tally: `server-action` → `mapKindServerAction`. */
export function kindField(group: 'Kind' | 'Dark', kind: RouteKind): string {
  return `${PREFIX}${group}${pascal(kind)}`
}

/** Field name for a per-sensitivity tally: `money` → `mapSensitiveMoney`. */
export function sensitiveField(group: 'Sensitive' | 'Dark', label: SensitivityLabel): string {
  return `${PREFIX}${group}${pascal(label)}`
}

/** What the run was asked to gate on, from the two flags that can gate it. */
export function resolveGate(input: { minScore: boolean, baseline: boolean }): MapGate {
  if (input.minScore && input.baseline) return 'both'
  if (input.minScore) return 'min-score'
  if (input.baseline) return 'baseline'
  return 'none'
}

/** Per-rule failure and suppression tallies across every scanned entry point. */
function ruleTallies(scan: ScanResult): Record<string, number> {
  const out: Record<string, number> = {}
  for (const rule of RULES) {
    out[ruleField('Fail', rule.id)] = 0
    out[ruleField('Suppressed', rule.id)] = 0
  }

  for (const route of scan.map.routes) {
    for (const [id, check] of Object.entries(route.checks) as [CheckId, { status: string, suppressed?: true }][]) {
      if (check.suppressed) out[ruleField('Suppressed', id)]! += 1
      else if (check.status === 'fail') out[ruleField('Fail', id)]! += 1
    }
  }

  return out
}

/**
 * Per-kind totals and dark tallies across every scanned entry point.
 *
 * A kind absent from the project is omitted rather than sent as zero, the
 * same convention as flags left at their default. A kind that is present but
 * fully covered still reports its dark count as 0, so the pair reads as
 * "12 pages, 3 dark" and never as "12 pages, count missing".
 */
function kindTallies(routes: RouteEntry[]): Record<string, number> {
  const total: Partial<Record<RouteKind, number>> = {}
  const dark: Partial<Record<RouteKind, number>> = {}
  for (const route of routes) {
    total[route.kind] = (total[route.kind] ?? 0) + 1
    if (classifyRouteObservability(route) === 'dark') dark[route.kind] = (dark[route.kind] ?? 0) + 1
  }

  const out: Record<string, number> = {}
  for (const kind of KINDS) {
    const count = total[kind]
    if (count === undefined) continue
    out[kindField('Kind', kind)] = count
    out[kindField('Dark', kind)] = dark[kind] ?? 0
  }
  return out
}

/**
 * Per-sensitivity totals and dark tallies (money / auth / pii).
 *
 * Sensitivity is a heuristic classification, not ground truth: these counts
 * say what the classifier found, so a population-level "dark money handlers"
 * number has to be read as an estimate. Labels are mutually exclusive per
 * entry point (`sensitivityLabel` precedence), so the total and dark buckets
 * stay disjoint.
 */
function sensitiveTallies(routes: RouteEntry[]): Record<string, number> {
  const total: Partial<Record<SensitivityLabel, number>> = {}
  const dark: Partial<Record<SensitivityLabel, number>> = {}
  for (const route of routes) {
    const label = sensitivityLabel(route.sensitivity)
    if (!label) continue
    total[label] = (total[label] ?? 0) + 1
    if (classifyRouteObservability(route) === 'dark') dark[label] = (dark[label] ?? 0) + 1
  }

  const out: Record<string, number> = {}
  for (const label of SENSITIVITIES) {
    const count = total[label]
    if (count === undefined) continue
    out[sensitiveField('Sensitive', label)] = count
    out[sensitiveField('Dark', label)] = dark[label] ?? 0
  }
  return out
}

/** Every field {@link recordMapRun} can emit — the payload shape, in one place. */
export function mapTelemetryFields(input: {
  scan: ScanResult
  frameworkForced: boolean
  gate: MapGate
  minScore?: number
  baseline: BaselineComparison | null
  view: MapView
  wrote: boolean
}): Record<string, boolean | number | string> {
  const { scan } = input
  const { routes } = scan.map

  const fields: Record<string, boolean | number | string> = {
    mapFramework: scan.map.framework,
    mapFrameworkForced: input.frameworkForced,
    mapScore: scan.map.score,
    mapGrade: scan.grade,
    mapView: input.view,
    mapWrote: input.wrote,
    mapEntryPoints: routes.length,
    mapSensitive: routes.filter(route => route.sensitivity.level === 'high').length,
    mapInstrumented: scan.summary.instrumented,
    mapPartial: scan.summary.partial,
    mapDark: scan.summary.dark,
    mapExempt: scan.summary.exempt,
    mapSuppressedChecks: scan.summary.suppressedChecks,
    mapWarnings: scan.warnings.length,
    mapSuggestions: routes.reduce((total, route) => total + Object.keys(route.suggestions).length, 0),
    mapProjectSuggestions: scan.suggestions.length,
    mapGate: input.gate,
    ...kindTallies(routes),
    ...sensitiveTallies(routes),
    ...ruleTallies(scan),
  }

  if (input.minScore !== undefined) fields.mapMinScore = input.minScore
  if (input.baseline) {
    fields.mapBaselineDelta = input.baseline.delta
    fields.mapBaselineRegressions = input.baseline.regressions.length
    fields.mapBaselineFixed = input.baseline.fixed.length
    fields.mapBaselineAdded = input.baseline.added.length
  }

  /* Whether CI actually went red. The count of people who wired a gate at all
     is the adoption number; this is the one that says it does something. */
  fields.mapGateFailed
    = (input.minScore !== undefined && scan.map.score < input.minScore)
      || (input.baseline !== null && hasRegressed(input.baseline))

  return fields
}

/** Record one `evlog map` scan on the active telemetry run. */
export function recordMapRun(input: Parameters<typeof mapTelemetryFields>[0]): void {
  /* Typed for numbers and booleans because strings need an allowlisted key —
     ours are, on the wrapper. The cast cannot get an unlisted value past
     `sanitizeCustom`. */
  telemetry.set(mapTelemetryFields(input) as Record<string, boolean | number>)
}

/**
 * Every field name this module can emit — used to document the disclosure.
 *
 * Read off a synthetic payload rather than listed again: a field added to one
 * and not the other would leave the disclosure quietly incomplete, and what
 * this CLI transmits is exactly the thing that must not drift.
 *
 * The kind and sensitivity tallies are the one deliberate exception: absent
 * kinds are omitted from the payload, so the empty synthetic scan cannot name
 * them, and the disclosure has to list every field the module *can* emit
 * rather than every field an empty project would.
 */
export function mapTelemetryFieldNames(): string[] {
  const empty: ScanResult = {
    map: { version: 1, generatedAt: '', framework: 'nuxt', projectName: '', score: 100, routes: [] },
    grade: 'excellent',
    project: {} as ScanResult['project'],
    suggestions: [],
    warnings: [],
    summary: { instrumented: 0, partial: 0, dark: 0, exempt: 0, suppressedChecks: 0 },
  }

  const emptyBaseline: BaselineComparison = {
    source: { kind: 'file', label: '' },
    baselineScore: 100,
    score: 100,
    delta: 0,
    totalDelta: 0,
    regressions: [],
    fixed: [],
    added: [],
    removed: [],
  }

  const payload = Object.keys(mapTelemetryFields({
    scan: empty,
    frameworkForced: false,
    gate: 'none',
    minScore: 0,
    baseline: emptyBaseline,
    view: 'summary',
    wrote: false,
  }))

  const tallies = [
    ...KINDS.flatMap(kind => [kindField('Kind', kind), kindField('Dark', kind)]),
    ...SENSITIVITIES.flatMap(label => [sensitiveField('Sensitive', label), sensitiveField('Dark', label)]),
  ]

  return [...payload, ...tallies]
}
