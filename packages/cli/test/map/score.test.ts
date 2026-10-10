import { describe, expect, it } from 'vitest'
import { getRule } from '../../src/lib/map/rules/index'
import { gradeFromScore, hasScoredRoutes, passesMinScore, scoreGlobal, scoreRoute } from '../../src/lib/map/score'
import type { CheckResult, RouteEntry } from '../../src/lib/map/types'

/** Asked of the registry rather than hard-coded: a weight change must not read as a scoring bug. */
function weightOf(id: 'wide-event' | 'context'): number {
  const rule = getRule(id)
  if (!rule || rule.category !== 'requirement') throw new Error(`${id} is not a requirement`)
  return rule.weight
}

/** A complete entry point, so that classification reads the same fields it does in a real scan. */
function route(overrides: Partial<RouteEntry> = {}): RouteEntry {
  return {
    id: 'r',
    framework: 'nuxt',
    kind: 'api',
    method: 'GET',
    path: '/api/orders',
    file: 'server/api/orders.get.ts',
    handler: null,
    checks: { 'wide-event': { status: 'pass' }, 'context': { status: 'pass' } },
    suggestions: {},
    sensitivity: { level: 'none', reasons: [] },
    score: 100,
    ...overrides,
  }
}

describe('score', () => {
  it('subtracts weights for failed checks', () => {
    const checks: Record<string, CheckResult> = {
      'wide-event': { status: 'fail' },
      'context': { status: 'pass' },
    }
    expect(scoreRoute(checks)).toBe(100 - weightOf('wide-event'))
  })

  it('never goes below zero', () => {
    const checks = Object.fromEntries(
      (['wide-event', 'context'] as const).map(id => [id, { status: 'fail' } as CheckResult]),
    )
    expect(scoreRoute({ ...checks, unknown: { status: 'fail' } } as Record<string, CheckResult>))
      .toBeGreaterThanOrEqual(0)
  })

  it('computes weighted global score', () => {
    expect(scoreGlobal([
      route({ score: 100 }),
      route({ score: 50, sensitivity: { level: 'high', reasons: ['money'] } }),
    ])).toBe(67)
  })

  it('weighs a page as a page even when it is sensitive', () => {
    /* 0.5 for the page, not 2 for the sensitivity: (100×1 + 0×0.5) / 1.5. */
    expect(scoreGlobal([
      route({ score: 100 }),
      route({
        score: 0,
        kind: 'page',
        sensitivity: { level: 'high', reasons: ['money'] },
        checks: { 'page-error-handling': { status: 'fail' } },
      }),
    ])).toBe(67)
  })

  it('leaves exempt entry points out of the average instead of letting their free 100 lift it', () => {
    const ingest = route({ path: '/_evlog/ingest', file: 'server/routes/_evlog/ingest.post.ts', score: 100 })

    expect(scoreGlobal([route({ score: 40 }), ingest])).toBe(40)
  })

  it('reads a page with nothing to fetch as exempt rather than as a free 100', () => {
    /* `page-error-handling` reports `n/a` for a page that fetches nothing, so
       the page is not an entry point the score has an opinion about. */
    const staticPage = route({ kind: 'page', score: 100, checks: { 'page-error-handling': { status: 'n/a' } } })

    expect(scoreGlobal([route({ score: 40 }), staticPage])).toBe(40)
  })

  it('scores an empty project as perfect rather than dividing by zero', () => {
    expect(scoreGlobal([])).toBe(100)
  })

  it('knows a project with nothing to score from one with an exempt-only set', () => {
    expect(hasScoredRoutes([])).toBe(false)
    expect(hasScoredRoutes([route({ path: '/_evlog/ingest', file: '_evlog/ingest.post.ts' })])).toBe(false)
    expect(hasScoredRoutes([route()])).toBe(true)
  })

  it.each([
    ['unscored', 100, 0, false],
    ['unscored', 100, 100, false],
    ['excellent', 100, 100, true],
    ['needs-work', 40, 80, false],
  ] as const)('gates a %s score of %i against --min-score %i: passes %s', (grade, score, threshold, passes) => {
    expect(passesMinScore(grade, score, threshold)).toBe(passes)
  })

  it('scores a project of nothing but exempt entry points as perfect', () => {
    expect(scoreGlobal([route({ path: '/_evlog/ingest', file: '_evlog/ingest.post.ts', score: 20 })])).toBe(100)
  })

  it.each([
    [100, 'excellent'],
    [90, 'excellent'],
    [89, 'good'],
    [70, 'good'],
    [69, 'needs-work'],
    [50, 'needs-work'],
    [49, 'at-risk'],
    [0, 'at-risk'],
  ])('grades %i as %s', (score, grade) => {
    expect(gradeFromScore(score)).toBe(grade)
  })
})
