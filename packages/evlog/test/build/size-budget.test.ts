import { beforeAll, describe, expect, it } from 'vitest'
import type { ScenarioSize } from '../../bench/scripts/size-budget'
import { measureScenarios, measureUnpacked, sizeBudget } from '../../bench/scripts/size-budget'
import { defined } from '../helpers/defined'

describe('bundle-size budget', () => {
  let scenarios: ScenarioSize[]

  beforeAll(async () => {
    scenarios = await measureScenarios()
  }, 60_000)

  it('has a budget for every scenario and a scenario for every budget', () => {
    expect(scenarios.map(s => s.scenario).sort()).toEqual(Object.keys(sizeBudget.scenarios).sort())
  })

  it('bundles the built dist through package exports, not src', () => {
    for (const { scenario, modules } of scenarios) {
      expect(modules.filter(m => m.startsWith('src/')), scenario).toEqual([])
    }
    expect(defined(scenarios.find(s => s.scenario === 'hono'), 'hono').modules).toContain('dist/hono/index.mjs')
    expect(defined(scenarios.find(s => s.scenario === 'axiom'), 'axiom').modules).toContain('dist/adapters/axiom.mjs')
  })

  it('keeps every scenario within its gzip budget', () => {
    for (const { scenario, gzip } of scenarios) {
      expect(gzip, `${scenario} gzip bytes; see bench/baseline/size-budget.json`).toBeLessThanOrEqual(defined(sizeBudget.scenarios[scenario], scenario).gzip)
    }
  })

  it('keeps the unpacked tarball within its budget', () => {
    expect(measureUnpacked(), 'unpacked bytes; see bench/baseline/size-budget.json').toBeLessThanOrEqual(sizeBudget.unpacked.bytes)
  }, 60_000)
})
