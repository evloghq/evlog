import { describe, expect, it } from 'vitest'
import { getRouteExemption, isInfrastructureRoute } from '../../src/lib/map/exemptions'
import type { ProjectFacts } from '../../src/lib/map/project-facts'
import { runRules } from '../../src/lib/map/rules/index'
import type { RuleTarget } from '../../src/lib/map/rules/index'
import { classifyRouteObservability } from '../../src/lib/map/score'
import type { RouteEntry, ScanContext } from '../../src/lib/map/types'

describe('exemptions', () => {
  it('exempts evlog ingest routes', () => {
    const route = {
      path: '/api/evlog/ingest',
      file: 'app/api/evlog/ingest/route.ts',
    }
    expect(getRouteExemption(route)?.reason).toContain('infrastructure')
    expect(isInfrastructureRoute(route)).toBe(true)
  })

  it('does not exempt normal api routes', () => {
    expect(isInfrastructureRoute({ path: '/api/checkout', file: 'app/api/checkout/route.ts' })).toBe(false)
  })

  it.each([
    ['/_evlog/ingest', 'server/routes/_evlog/ingest.post.ts'],
    ['/evlog/ingest', 'server/api/evlog/ingest.post.ts'],
  ])('exempts the ingest endpoint spelled %s', (path, file) => {
    expect(isInfrastructureRoute({ path, file })).toBe(true)
  })

  /* An exemption waives every rule, so a loose match is the worst bug this tool
     can have: the handler leaves the score without ever being reported. */
  it.each([
    ['a file whose name merely starts with the pattern', '/api/ingestable', 'lib/evlog/ingestable.ts'],
    ['a longer route under the same directory', '/api/evlog/ingestion-report', 'app/api/evlog/ingestion-report/route.ts'],
    ['a directory whose name merely ends with evlog', '/api/legacy-evlog/ingest-report', 'routes/api/legacy-evlog/ingest-report.ts'],
  ])('does not exempt %s', (_name, path, file) => {
    expect(isInfrastructureRoute({ path, file })).toBe(false)
  })

  it('classifies exempt routes separately from dark', () => {
    const route = {
      id: 'x',
      framework: 'next' as const,
      kind: 'api' as const,
      method: 'POST',
      path: '/api/evlog/ingest',
      file: 'app/api/evlog/ingest/route.ts',
      handler: null,
      checks: { 'wide-event': { status: 'n/a' as const } },
      suggestions: {},
      sensitivity: { level: 'none' as const, reasons: [] },
      score: 100,
    } satisfies RouteEntry
    expect(classifyRouteObservability(route)).toBe('exempt')
  })

  it('keeps an exempt route exempt when its file cannot be parsed', () => {
    const target: RuleTarget = {
      framework: 'next',
      kind: 'api',
      method: 'POST',
      path: '/api/evlog/ingest',
      file: 'app/api/evlog/ingest/route.ts',
      handler: null,
      sensitivity: { level: 'none', reasons: [] },
    }
    const ctx: ScanContext = {
      projectRoot: '/tmp',
      framework: 'next',
      projectName: 'test',
      hasEvlog: true,
      verbose: false,
    }
    const project: ProjectFacts = {
      dependencies: new Set(),
      features: new Set(),
      pairable: new Set(),
      catalogs: [],
      evlogBarrels: new Map(),
      evlogPackages: new Map(),
      repeatedErrors: new Map(),
    }

    /* An unreadable file is a hard fail for every requirement — unless the route
       was never held to them, in which case failing it reads as a gap that the
       exemption promised would not appear. */
    const { checks } = runRules({
      ctx,
      target,
      parsed: null,
      facts: null,
      project,
      capabilities: { requestLogger: 'explicit', evlogAutoImports: [] },
    })

    const statuses = new Set(Object.values(checks).map(check => check?.status))
    expect(statuses).toEqual(new Set(['n/a']))
    expect(Object.values(checks).every(check => check?.message?.includes('infrastructure'))).toBe(true)
  })

  it('still fails every requirement on an unreadable file that is not exempt', () => {
    const { checks } = runRules({
      ctx: { projectRoot: '/tmp', framework: 'next', projectName: 'test', hasEvlog: true, verbose: false },
      target: {
        framework: 'next',
        kind: 'api',
        method: 'POST',
        path: '/api/checkout',
        file: 'app/api/checkout/route.ts',
        handler: null,
        sensitivity: { level: 'none', reasons: [] },
      },
      parsed: null,
      facts: null,
      project: {
        dependencies: new Set(),
        features: new Set(),
        pairable: new Set(),
        catalogs: [],
        evlogBarrels: new Map(),
        evlogPackages: new Map(),
        repeatedErrors: new Map(),
      },
      capabilities: { requestLogger: 'explicit', evlogAutoImports: [] },
    })

    expect(Object.values(checks).every(check => check?.status === 'fail')).toBe(true)
  })
})
