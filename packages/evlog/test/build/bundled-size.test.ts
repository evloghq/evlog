import { beforeAll, describe, expect, it } from 'vitest'
import type { BundledSizeReport } from '../../bench/scripts/bundled-size'
import { measureBundledSize } from '../../bench/scripts/bundled-size'
import { defined } from '../helpers/defined'

describe('bundled-size script', () => {
  let report: BundledSizeReport

  // Bundles all four fixtures once; winston is the slowest.
  beforeAll(async () => {
    report = await measureBundledSize()
  }, 120_000)

  it('bundles the canonical setup of each library and reports raw, gzip and module counts', () => {
    expect(report.bundler.name).toBe('esbuild')
    expect(report.options).toEqual({ platform: 'node', format: 'esm', target: 'node18', minify: true })

    // Every library measured, sorted by gzip, smallest first.
    expect(report.entries.map(entry => entry.library).sort()).toEqual(['consola', 'evlog', 'pino', 'winston'])
    const gzips = report.entries.map(entry => entry.gzip)
    expect([...gzips].sort((a, b) => a - b)).toEqual(gzips)

    for (const entry of report.entries) {
      expect(entry.version, entry.library).toMatch(/^\d+\.\d+/)
      expect(entry.raw, entry.library).toBeGreaterThan(0)
      expect(entry.gzip, entry.library).toBeGreaterThan(0)
      expect(entry.gzip, entry.library).toBeLessThan(entry.raw)
      expect(entry.modules, entry.library).toBeGreaterThan(0)
    }
  })

  it('keeps the evlog basic setup the smallest bundle of the comparison', () => {
    const evlog = defined(report.entries.find(entry => entry.library === 'evlog'), 'evlog entry')

    for (const entry of report.entries) {
      if (entry.library === 'evlog') continue
      expect(evlog.gzip, `${entry.library} bundles larger than evlog`).toBeLessThan(entry.gzip)
    }
  })
})
