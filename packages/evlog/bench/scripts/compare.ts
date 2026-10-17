/**
 * Benchmark + bundle size comparison script.
 *
 * Compares vitest bench JSON outputs and/or size reports, then generates
 * a unified markdown report for PR comments.
 *
 * Usage:
 *   tsx bench/scripts/compare.ts --bench <baseline.json> <current.json>
 *   tsx bench/scripts/compare.ts --size <baseline.json> <current.json>
 *   tsx bench/scripts/compare.ts --bench <base> <curr> --size <base> <curr>
 *
 * Exits with code 1 if any benchmark regressed by more than the threshold.
 */

import { readFile } from 'node:fs/promises'

// --- Types ---

interface BenchmarkEntry {
  name: string
  hz: number
  mean: number
  p99: number
  rme: number
  sampleCount: number
}

interface BenchGroup {
  fullName: string
  benchmarks: BenchmarkEntry[]
}

interface BenchFile {
  filepath: string
  groups: BenchGroup[]
}

interface BenchReport {
  files: BenchFile[]
}

interface EntrySize {
  entry: string
  raw: number
  gzip: number
}

interface SizeReport {
  entries: EntrySize[]
  total: { raw: number, gzip: number }
}

// --- Config ---

const REGRESSION_THRESHOLD = 10
const SIZE_THRESHOLD = 5

// --- Helpers ---

async function loadJSON<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw) as T
}

function formatHz(hz: number): string {
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)}M`
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(1)}K`
  return hz.toFixed(0)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(2)} kB`
}

function formatDelta(delta: number): string {
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

function formatBytesDelta(base: number, curr: number): string {
  const diff = curr - base
  const sign = diff > 0 ? '+' : ''
  return `${sign}${formatBytes(diff)}`
}

function getPerfIndicator(delta: number): string {
  if (delta <= -REGRESSION_THRESHOLD) return '🔴'
  if (delta <= -3) return '🟡'
  if (delta >= REGRESSION_THRESHOLD) return '🟢'
  if (delta >= 3) return '🟢'
  return '⚪'
}

function getSizeIndicator(delta: number): string {
  if (delta >= SIZE_THRESHOLD) return '🔴'
  if (delta >= 2) return '🟡'
  if (delta <= -SIZE_THRESHOLD) return '🟢'
  if (delta <= -2) return '🟢'
  return '⚪'
}

// --- Bench comparison ---

function hasBaselineData(report: BenchReport): boolean {
  return report.files.some(f => f.groups.some(g => g.benchmarks.length > 0))
}

function renderFirstRunBenchmarks(current: BenchReport): string {
  const lines: string[] = []
  lines.push('### Performance (first run — no baseline to compare)')
  lines.push('')
  lines.push('| Benchmark | ops/sec | Mean | p99 |')
  lines.push('|-----------|--------:|-----:|----:|')

  for (const file of current.files) {
    for (const group of file.groups) {
      for (const bench of group.benchmarks) {
        const shortName = `${group.fullName} > ${bench.name}`.replace(/^bench\/[^>]+> /, '')
        lines.push(
          `| ${shortName} | ${formatHz(bench.hz)} | ${bench.mean.toFixed(4)}ms | ${bench.p99.toFixed(4)}ms |`,
        )
      }
    }
  }

  return lines.join('\n')
}

function compareBenchmarks(baseline: BenchReport, current: BenchReport): { markdown: string, hasRegression: boolean } {
  if (!hasBaselineData(baseline)) {
    return { markdown: renderFirstRunBenchmarks(current), hasRegression: false }
  }

  const baseMap = new Map<string, BenchmarkEntry>()
  for (const file of baseline.files) {
    for (const group of file.groups) {
      for (const bench of group.benchmarks) {
        baseMap.set(`${group.fullName} > ${bench.name}`, bench)
      }
    }
  }

  const rows: Array<{
    name: string
    baseHz: number
    currHz: number
    delta: number
    indicator: string
    p99Base: number
    p99Curr: number
  }> = []

  let hasRegression = false

  for (const file of current.files) {
    for (const group of file.groups) {
      for (const bench of group.benchmarks) {
        const key = `${group.fullName} > ${bench.name}`
        const base = baseMap.get(key)
        if (!base) continue

        const delta = ((bench.hz - base.hz) / base.hz) * 100
        if (delta <= -REGRESSION_THRESHOLD) hasRegression = true

        rows.push({
          name: key,
          baseHz: base.hz,
          currHz: bench.hz,
          delta,
          indicator: getPerfIndicator(delta),
          p99Base: base.p99,
          p99Curr: bench.p99,
        })
      }
    }
  }

  rows.sort((a, b) => a.delta - b.delta)

  const lines: string[] = []
  lines.push('### Performance')
  lines.push('')
  lines.push(`> Threshold: **${REGRESSION_THRESHOLD}%** · 🔴 regression · 🟡 warning · 🟢 improvement · ⚪ unchanged`)
  lines.push('')
  lines.push('| Status | Benchmark | Base (ops/sec) | Current (ops/sec) | Change | p99 base | p99 current |')
  lines.push('|--------|-----------|---------------:|------------------:|-------:|---------:|------------:|')

  for (const row of rows) {
    const shortName = row.name.replace(/^bench\/[^>]+> /, '')
    lines.push(
      `| ${row.indicator} | ${shortName} | ${formatHz(row.baseHz)} | ${formatHz(row.currHz)} | ${formatDelta(row.delta)} | ${row.p99Base.toFixed(4)}ms | ${row.p99Curr.toFixed(4)}ms |`,
    )
  }

  lines.push('')

  const regressions = rows.filter(r => r.delta <= -REGRESSION_THRESHOLD)
  const improvements = rows.filter(r => r.delta >= REGRESSION_THRESHOLD)
  const warnings = rows.filter(r => r.delta <= -3 && r.delta > -REGRESSION_THRESHOLD)

  lines.push('<details>')
  lines.push('<summary>Summary</summary>')
  lines.push('')
  lines.push(`- **${regressions.length}** regressions (>${REGRESSION_THRESHOLD}% slower)`)
  lines.push(`- **${warnings.length}** warnings (3-${REGRESSION_THRESHOLD}% slower)`)
  lines.push(`- **${improvements.length}** improvements (>${REGRESSION_THRESHOLD}% faster)`)
  lines.push(`- **${rows.length - regressions.length - improvements.length - warnings.length}** unchanged`)
  lines.push('')
  lines.push('</details>')

  if (hasRegression) {
    lines.push('')
    lines.push('> [!WARNING]')
    lines.push(`> Performance regressions detected (>${REGRESSION_THRESHOLD}% slower). Review before merging.`)
  }

  return { markdown: lines.join('\n'), hasRegression }
}

// --- Size comparison ---

function hasBaselineSizeData(report: SizeReport): boolean {
  return report.entries.length > 0
}

function renderFirstRunSizes(current: SizeReport): string {
  const lines: string[] = []
  lines.push('### Bundle size (first run — no baseline to compare)')
  lines.push('')
  lines.push('| Entry | Raw | Gzip |')
  lines.push('|-------|----:|-----:|')

  for (const entry of current.entries) {
    lines.push(`| ${entry.entry} | ${formatBytes(entry.raw)} | ${formatBytes(entry.gzip)} |`)
  }

  lines.push(`| **Total** | **${formatBytes(current.total.raw)}** | **${formatBytes(current.total.gzip)}** |`)

  return lines.join('\n')
}

function compareSizes(baseline: SizeReport, current: SizeReport): string {
  if (!hasBaselineSizeData(baseline)) {
    return renderFirstRunSizes(current)
  }

  const baseMap = new Map(baseline.entries.map(e => [e.entry, e]))

  const rows: Array<{
    entry: string
    isNew: boolean
    baseGzip: number
    currGzip: number
    baseRaw: number
    currRaw: number
    delta: number
    indicator: string
  }> = []

  for (const curr of current.entries) {
    const base = baseMap.get(curr.entry)
    const isNew = !base
    const baseGzip = base?.gzip ?? 0
    const baseRaw = base?.raw ?? 0
    const delta = baseGzip > 0 ? ((curr.gzip - baseGzip) / baseGzip) * 100 : 0

    rows.push({
      entry: curr.entry,
      isNew,
      baseGzip,
      currGzip: curr.gzip,
      baseRaw,
      currRaw: curr.raw,
      delta,
      indicator: isNew ? '🆕' : getSizeIndicator(delta),
    })
  }

  rows.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1
    return b.delta - a.delta
  })

  const totalBase = baseline.total
  const totalCurr = current.total
  const totalDelta = totalBase.gzip > 0
    ? ((totalCurr.gzip - totalBase.gzip) / totalBase.gzip) * 100
    : 0

  const lines: string[] = []
  lines.push('### Bundle size')
  lines.push('')
  lines.push(`> Threshold: **${SIZE_THRESHOLD}%** · 🔴 larger · 🟡 warning · 🟢 smaller · ⚪ unchanged · 🆕 new`)
  lines.push('')
  lines.push('| Status | Entry | Base (gzip) | Current (gzip) | Change | Raw delta |')
  lines.push('|--------|-------|------------:|---------------:|-------:|----------:|')

  for (const row of rows) {
    const baseCol = row.isNew ? '—' : formatBytes(row.baseGzip)
    const changeCol = row.isNew ? 'new' : formatDelta(row.delta)
    const rawDeltaCol = row.isNew ? `+${formatBytes(row.currRaw)}` : formatBytesDelta(row.baseRaw, row.currRaw)
    lines.push(
      `| ${row.indicator} | ${row.entry} | ${baseCol} | ${formatBytes(row.currGzip)} | ${changeCol} | ${rawDeltaCol} |`,
    )
  }

  lines.push(`| **${getSizeIndicator(totalDelta)}** | **Total** | **${formatBytes(totalBase.gzip)}** | **${formatBytes(totalCurr.gzip)}** | **${formatDelta(totalDelta)}** | **${formatBytesDelta(totalBase.raw, totalCurr.raw)}** |`)

  return lines.join('\n')
}

// --- CLI ---

function parseArgs(): { benchBase?: string, benchCurr?: string, sizeBase?: string, sizeCurr?: string } {
  const args = process.argv.slice(2)
  const result: { benchBase?: string, benchCurr?: string, sizeBase?: string, sizeCurr?: string } = {}

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bench' && args[i + 1] && args[i + 2]) {
      result.benchBase = args[i + 1]
      result.benchCurr = args[i + 2]
      i += 2
    } else if (args[i] === '--size' && args[i + 1] && args[i + 2]) {
      result.sizeBase = args[i + 1]
      result.sizeCurr = args[i + 2]
      i += 2
    }
  }

  return result
}

const parsed = parseArgs()

if (!parsed.benchBase && !parsed.sizeBase) {
  console.error('Usage:')
  console.error('  tsx bench/scripts/compare.ts --bench <baseline.json> <current.json>')
  console.error('  tsx bench/scripts/compare.ts --size <baseline.json> <current.json>')
  console.error('  tsx bench/scripts/compare.ts --bench <base> <curr> --size <base> <curr>')
  process.exit(1)
}

const sections: string[] = []
sections.push('## Benchmark report')
sections.push('')

let hasRegression = false

if (parsed.benchBase && parsed.benchCurr) {
  const baseline = await loadJSON<BenchReport>(parsed.benchBase)
  const current = await loadJSON<BenchReport>(parsed.benchCurr)
  const { markdown, hasRegression: regression } = compareBenchmarks(baseline, current)
  sections.push(markdown)
  hasRegression = regression
}

if (parsed.sizeBase && parsed.sizeCurr) {
  const baseline = await loadJSON<SizeReport>(parsed.sizeBase)
  const current = await loadJSON<SizeReport>(parsed.sizeCurr)
  sections.push('')
  sections.push(compareSizes(baseline, current))
}

console.log(sections.join('\n'))

if (hasRegression) process.exit(1)
