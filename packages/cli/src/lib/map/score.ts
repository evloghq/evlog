import type { CheckId, CheckResult, Grade, RouteEntry } from './types'
import { isInfrastructureRoute } from './exemptions'
import { REQUIREMENTS, getRule } from './rules/index'

/** Fallback weight for a rule id that is not in the registry. */
const UNKNOWN_WEIGHT = 10

/**
 * Score one entry point from its requirement results.
 *
 * Opportunities are deliberately unreachable from here: they live in
 * `route.suggestions`, and their type carries no weight to subtract.
 */
export function scoreRoute(checks: Partial<Record<CheckId, CheckResult>>): number {
  let score = 100
  for (const [id, result] of Object.entries(checks) as [CheckId, CheckResult][]) {
    if (result.status !== 'fail') continue
    const rule = getRule(id)
    if (rule && rule.category !== 'requirement') continue
    score -= rule?.category === 'requirement' ? rule.weight : UNKNOWN_WEIGHT
  }
  return Math.max(0, score)
}

/**
 * Weighted average of the per-entry scores.
 *
 * The weights say which entry points the number should follow: a sensitive
 * handler counts double, a page counts half. Page wins when both apply — a page
 * that touches money is still a page, and its own rule set is thinner, so
 * letting it weigh double would drag the project score on the strength of one
 * check.
 *
 * Exempt entries are left out entirely. Every rule is `n/a` for them, so they
 * score a free 100, and averaging those in would let a project of static pages
 * report a high score while its handlers are dark — the report already counts
 * them apart from real coverage, and the number has to agree with it.
 */
export function scoreGlobal(routes: RouteEntry[]): number {
  const scored = routes.filter(route => classifyRouteObservability(route) !== 'exempt')
  if (scored.length === 0) return 100

  let totalWeight = 0
  let weightedSum = 0

  for (const route of scored) {
    let weight = 1
    if (route.sensitivity.level === 'high') weight = 2
    if (route.kind === 'page') weight = 0.5

    totalWeight += weight
    weightedSum += route.score * weight
  }

  return Math.round(weightedSum / totalWeight)
}

/** Whether any entry point is one the score has an opinion about. */
export function hasScoredRoutes(routes: RouteEntry[]): boolean {
  return routes.some(route => classifyRouteObservability(route) !== 'exempt')
}

/**
 * The `--min-score` gate. A run with nothing to score cannot meet a threshold:
 * a free 100 would otherwise pass every gate a project asks for.
 */
export function passesMinScore(grade: Grade, score: number, threshold: number): boolean {
  return grade !== 'unscored' && score >= threshold
}

/** Grade band a score falls into, at 90 / 70 / 50. */
export function gradeFromScore(score: number): 'excellent' | 'good' | 'needs-work' | 'at-risk' {
  if (score >= 90) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 50) return 'needs-work'
  return 'at-risk'
}

/**
 * How much of an entry point the map can actually see.
 *
 * `exempt` covers both evlog's own plumbing and entry points with nothing to
 * instrument; neither belongs in the unobserved tally, because neither is a gap
 * anyone should close.
 */
export function classifyRouteObservability(route: RouteEntry): 'instrumented' | 'partial' | 'dark' | 'exempt' {
  if (isInfrastructureRoute(route)) return 'exempt'

  const { 'wide-event': wide, context } = route.checks

  if (route.kind === 'page') {
    const pageErr = route.checks['page-error-handling']
    if (pageErr?.status === 'pass') return 'instrumented'
    /* A page that fetches nothing has nothing to log: its rule reports `n/a`,
       and calling that dark would show a static page as an observability gap. */
    if (!pageErr || pageErr.status === 'n/a') return 'exempt'
    return 'dark'
  }

  if (wide?.status === 'pass' && context?.status === 'pass') return 'instrumented'
  if (wide?.status === 'pass' || context?.status === 'pass') return 'partial'
  return 'dark'
}

/** Compact per-rule status for terminal display, e.g. "logger ✓  context ✓  audit ✗". */
export function routeCheckChips(route: RouteEntry): string | null {
  const relevant = Object.entries(route.checks).filter(([, r]) => r?.status !== 'n/a') as [CheckId, CheckResult][]
  if (relevant.length === 0) return null

  const parts = relevant.map(([id, result]) => {
    const label = getRule(id)?.title ?? id
    const mark = result.status === 'pass' ? '✓' : '✗'
    return `${label} ${mark}`
  })

  return parts.join('  ')
}

/** The one line to show next to an entry point: its heaviest unmet requirement. */
export function topIssue(route: RouteEntry): string {
  const chips = routeCheckChips(route)
  const observability = classifyRouteObservability(route)

  if (observability === 'instrumented') {
    const failed = (Object.entries(route.checks) as [CheckId, CheckResult | undefined][])
      .filter(([, c]) => c?.status === 'fail')
    if (failed.length === 0) return 'ok'
    const [id, check] = failed[0]!
    if (id === 'audit') {
      return `gap: ${check?.message ?? 'missing audit'}`
    }
    return check?.message ?? id
  }

  if (observability === 'partial') {
    return chips ?? 'partial instrumentation'
  }

  /* Registry order is report order: the heaviest gap is named first. */
  for (const rule of REQUIREMENTS) {
    const check = route.checks[rule.id]
    if (check?.status === 'fail') {
      return check.message ?? rule.id
    }
  }
  return chips ?? 'ok'
}
