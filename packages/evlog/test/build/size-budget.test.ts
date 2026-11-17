import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import pkg from '../../package.json' with { type: 'json' }
import type { ScenarioSize } from '../../bench/scripts/size-budget'
import { staticImportClosure } from '../../bench/scripts/size'
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

describe('dist import graph', () => {
  // tsdown marks each source module in a chunk with a `// src/<path>` comment.
  it('loads audit.ts only from the root entry, which re-exports it', async () => {
    const loadingAudit: string[] = []
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (typeof target === 'string') continue
      const closure = await staticImportClosure(fileURLToPath(new URL(`../../${target.import}`, import.meta.url)))
      if ([...closure.values()].some(file => file.includes('// src/audit.ts\n'))) loadingAudit.push(subpath)
    }
    expect(loadingAudit).toEqual(['.'])
  })
})
