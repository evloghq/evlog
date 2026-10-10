import { describe, expect, it } from 'vitest'
import type { BaselineComparison } from '../../src/lib/map/baseline'
import { RULES } from '../../src/lib/map/rules/index'
import {
  MAP_TELEMETRY_FIELDS,
  kindField,
  mapTelemetryFieldNames,
  mapTelemetryFields,
  resolveGate,
  ruleField,
  sensitiveField,
} from '../../src/lib/map/telemetry'
import type { RouteEntry, RouteKind, ScanResult } from '../../src/lib/map/types'

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

function scan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    map: {
      version: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      framework: 'nuxt',
      projectName: 'shop',
      score: 72,
      routes: [route()],
      ...overrides.map,
    },
    grade: 'good',
    project: {} as ScanResult['project'],
    suggestions: [],
    warnings: [],
    ignored: 0,
    summary: { instrumented: 1, partial: 0, dark: 0, exempt: 0, suppressedChecks: 0 },
    ...overrides,
  }
}

function fields(overrides: Partial<Parameters<typeof mapTelemetryFields>[0]> = {}) {
  return mapTelemetryFields({
    scan: scan(),
    frameworkForced: false,
    gate: 'none',
    baseline: null,
    view: 'summary',
    wrote: true,
    config: null,
    ...overrides,
  })
}

describe('map telemetry', () => {
  it('reports the score and grade the run produced', () => {
    const out = fields()
    expect(out.mapScore).toBe(72)
    expect(out.mapGrade).toBe('good')
    expect(out.mapFramework).toBe('nuxt')
  })

  it('gives every registered rule a failure and a suppression tally', () => {
    /* An id missing from the payload is a rule nobody can see the cost of:
       the whole point is knowing which check fires and which gets waived. */
    const names = mapTelemetryFieldNames()
    for (const rule of RULES) {
      expect(names, rule.id).toContain(ruleField('Fail', rule.id))
      expect(names, rule.id).toContain(ruleField('Suppressed', rule.id))
    }
  })

  it('counts a failed check apart from a waived one', () => {
    const out = fields({
      scan: scan({
        map: {
          version: 1,
          generatedAt: '',
          framework: 'nuxt',
          projectName: 'shop',
          score: 50,
          routes: [
            route({ id: 'a', checks: { 'wide-event': { status: 'fail' } } }),
            route({ id: 'b', checks: { 'wide-event': { status: 'n/a', suppressed: true } } }),
          ],
        },
      }),
    })

    expect(out.mapFailWideEvent).toBe(1)
    expect(out.mapSuppressedWideEvent).toBe(1)
  })

  it('reports whether a gate actually failed the command', () => {
    expect(fields({ gate: 'min-score', minScore: 90 }).mapGateFailed).toBe(true)
    expect(fields({ gate: 'min-score', minScore: 70 }).mapGateFailed).toBe(false)
  })

  it('names both gates when both were asked for', () => {
    expect(resolveGate({ minScore: true, baseline: true })).toBe('both')
    expect(resolveGate({ minScore: false, baseline: true })).toBe('baseline')
    expect(resolveGate({ minScore: false, baseline: false })).toBe('none')
  })

  it('fails the gate on a baseline regression', () => {
    const baseline = {
      source: { kind: 'file', label: 'evlog.map.json' },
      baselineScore: 80,
      score: 72,
      delta: -8,
      totalDelta: -8,
      regressions: [{ routeId: 'a', path: '/a', method: null, file: 'a.ts', check: 'wide-event', to: 'fail' }],
      fixed: [],
      added: [],
      removed: [],
    } as BaselineComparison

    const out = fields({ gate: 'baseline', baseline })
    expect(out.mapGateFailed).toBe(true)
    expect(out.mapBaselineDelta).toBe(-8)
    expect(out.mapBaselineRegressions).toBe(1)
  })

  it('never names a field that could carry the project or a path', () => {
    for (const name of mapTelemetryFieldNames()) {
      expect(name).toMatch(/^map[A-Z]/)
      expect(name.toLowerCase()).not.toContain('path')
      expect(name.toLowerCase()).not.toContain('file')
      expect(name.toLowerCase()).not.toContain('name')
    }
  })

  it('allowlists every framework and grade a scan can report', () => {
    /* A value outside its allowlist is dropped without a word, so a new
       framework or grade band would go missing from the numbers rather than
       break loudly. */
    expect(MAP_TELEMETRY_FIELDS.mapFramework).toContain('tanstack-start')
    expect(MAP_TELEMETRY_FIELDS.mapFramework).toContain('hono')
    expect(MAP_TELEMETRY_FIELDS.mapGrade).toContain('at-risk')
  })

  it('counts entry points and dark entry points per kind', () => {
    const out = fields({
      scan: scan({
        map: {
          version: 1,
          generatedAt: '',
          framework: 'nuxt',
          projectName: 'shop',
          score: 50,
          routes: [
            route({ id: 'a', kind: 'page', checks: { 'page-error-handling': { status: 'fail' } } }),
            route({ id: 'b', kind: 'page', checks: { 'page-error-handling': { status: 'pass' } } }),
            route({ id: 'c', kind: 'api', checks: {} }),
            route({ id: 'd', kind: 'cron', checks: {} }),
          ],
        },
      }),
    })

    expect(out.mapKindPage).toBe(2)
    expect(out.mapDarkPage).toBe(1)
    expect(out.mapKindApi).toBe(1)
    expect(out.mapDarkApi).toBe(1)
    expect(out.mapKindCron).toBe(1)
    expect(out.mapDarkCron).toBe(1)
  })

  it('omits kinds absent from the project instead of sending zero', () => {
    const out = fields({
      scan: scan({
        map: {
          version: 1,
          generatedAt: '',
          framework: 'nuxt',
          projectName: 'shop',
          score: 50,
          routes: [route({ id: 'a', kind: 'cron' })],
        },
      }),
    })

    expect(out.mapKindCron).toBe(1)
    expect(out.mapDarkCron).toBe(0)
    expect('mapKindPage' in out).toBe(false)
    expect('mapDarkPage' in out).toBe(false)
    expect('mapKindWebsocket' in out).toBe(false)
  })

  it('reports a dark count of zero for a kind that is fully covered', () => {
    const out = fields({
      scan: scan({
        map: {
          version: 1,
          generatedAt: '',
          framework: 'nuxt',
          projectName: 'shop',
          score: 100,
          routes: [route({ id: 'a', checks: { 'wide-event': { status: 'pass' }, 'context': { status: 'pass' } } })],
        },
      }),
    })

    expect(out.mapKindApi).toBe(1)
    expect(out.mapDarkApi).toBe(0)
  })

  it('counts sensitive entry points and dark sensitive entry points by label', () => {
    const out = fields({
      scan: scan({
        map: {
          version: 1,
          generatedAt: '',
          framework: 'nuxt',
          projectName: 'shop',
          score: 50,
          routes: [
            route({ id: 'a', checks: {}, sensitivity: { level: 'high', reasons: ['money: imports stripe'] } }),
            route({
              id: 'b',
              checks: { 'wide-event': { status: 'pass' }, 'context': { status: 'pass' } },
              sensitivity: { level: 'high', reasons: ['auth: imports better-auth'] },
            }),
            route({ id: 'c', checks: {}, sensitivity: { level: 'medium', reasons: ['pii: write operation with sensitive fields'] } }),
          ],
        },
      }),
    })

    expect(out.mapSensitiveMoney).toBe(1)
    expect(out.mapDarkMoney).toBe(1)
    expect(out.mapSensitiveAuth).toBe(1)
    expect(out.mapDarkAuth).toBe(0)
    expect(out.mapSensitivePii).toBe(1)
    expect(out.mapDarkPii).toBe(1)
    expect('mapSensitiveNone' in out).toBe(false)
  })

  it('discloses a total and a dark field for every kind and sensitivity label', () => {
    const names = mapTelemetryFieldNames()
    const kinds: readonly RouteKind[] = ['api', 'page', 'middleware', 'server-action', 'cron', 'websocket']
    for (const kind of kinds) {
      expect(names).toContain(kindField('Kind', kind))
      expect(names).toContain(kindField('Dark', kind))
    }
    for (const label of ['money', 'auth', 'pii'] as const) {
      expect(names).toContain(sensitiveField('Sensitive', label))
      expect(names).toContain(sensitiveField('Dark', label))
    }
  })
})
