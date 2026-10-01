/**
 * Generate a human-readable markdown report from benchmark baseline JSON files.
 *
 * Usage:
 *   tsx bench/scripts/report.ts
 *
 * Reads from bench/baseline/{bench,bundled-size,comparison,size}.json
 * Writes to bench/RESULTS.md
 */

import { readFile, writeFile } from 'node:fs/promises'

// --- Types ---

interface BenchmarkEntry {
  name: string
  rank: number
  hz: number
  mean: number
  p75: number
  p99: number
  p995: number
  p999: number
  rme: number
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

interface BundledEntry {
  library: string
  version: string
  raw: number
  gzip: number
  modules: number
}

interface BundledSizeReport {
  bundler: { name: string, version: string }
  options: { platform: string, format: string, target: string, minify: boolean }
  entries: BundledEntry[]
}

// --- Helpers ---

function formatHz(hz: number): string {
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)}M`
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(1)}K`
  return hz.toFixed(0)
}

function formatNs(ms: number): string {
  const ns = ms * 1_000_000
  if (ns < 1000) return `${ns.toFixed(0)}ns`
  if (ns < 1_000_000) return `${(ns / 1000).toFixed(2)}µs`
  return `${ms.toFixed(3)}ms`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(2)} kB`
}

async function loadJSON<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function stripPrefix(fullName: string): string {
  return fullName.replace(/^bench\/(?:core\/|comparison\/)?[^>]+>\s*/, '')
}

// --- Report generators ---

function renderCoreBenchmarks(report: BenchReport): string {
  const lines: string[] = []
  lines.push('## Core benchmarks')
  lines.push('')

  for (const file of report.files) {
    for (const group of file.groups) {
      if (group.benchmarks.length === 0) continue

      const groupName = stripPrefix(group.fullName)
      lines.push(`### ${groupName}`)
      lines.push('')
      lines.push('| Benchmark | ops/sec | Mean | p99 | Samples |')
      lines.push('|-----------|--------:|-----:|----:|--------:|')

      const sorted = [...group.benchmarks].sort((a, b) => b.hz - a.hz)
      for (const b of sorted) {
        lines.push(`| ${b.name} | **${formatHz(b.hz)}** | ${formatNs(b.mean)} | ${formatNs(b.p99)} | ${Math.floor(b.hz).toLocaleString()} |`)
      }

      lines.push('')
    }
  }

  return lines.join('\n')
}

function renderComparison(report: BenchReport): string {
  const lines: string[] = []
  lines.push('## Comparison vs alternatives')
  lines.push('')
  lines.push('> All loggers configured for JSON output to no-op destinations.')
  lines.push('> See `bench/comparison/vs-alternatives.bench.ts` for methodology.')
  lines.push('')

  for (const file of report.files) {
    for (const group of file.groups) {
      if (group.benchmarks.length === 0) continue

      const groupName = stripPrefix(group.fullName)
      lines.push(`### ${groupName}`)
      lines.push('')
      lines.push('| Library | ops/sec | Mean | Relative |')
      lines.push('|---------|--------:|-----:|---------:|')

      const sorted = [...group.benchmarks].sort((a, b) => b.hz - a.hz)
      const fastest = sorted[0]!

      for (const b of sorted) {
        const relative = b === fastest ? '**fastest**' : `${(fastest.hz / b.hz).toFixed(2)}x slower`
        const name = b.name.replace(/ — .*/, '').replace(/ \(.*\)/, '')
        lines.push(`| ${name} | **${formatHz(b.hz)}** | ${formatNs(b.mean)} | ${relative} |`)
      }

      lines.push('')
    }
  }

  return lines.join('\n')
}

function renderBundleSize(report: SizeReport): string {
  const lines: string[] = []
  lines.push('## Bundle size')
  lines.push('')
  lines.push('| Entry | Raw | Gzip |')
  lines.push('|-------|----:|-----:|')

  for (const entry of report.entries) {
    lines.push(`| ${entry.entry} | ${formatBytes(entry.raw)} | ${formatBytes(entry.gzip)} |`)
  }

  lines.push(`| **Total** | **${formatBytes(report.total.raw)}** | **${formatBytes(report.total.gzip)}** |`)
  lines.push('')

  return lines.join('\n')
}

function renderBundledSize(report: BundledSizeReport): string {
  const lines: string[] = []
  lines.push('## Bundled size vs alternatives')
  lines.push('')
  lines.push(`> Canonical basic setup per library (\`bench/bundled/\`), bundled with ${report.bundler.name} ${report.bundler.version} (${report.options.format}, platform ${report.options.platform}, target ${report.options.target}, minify ${report.options.minify ? 'on' : 'off'}), gzipped.`)
  lines.push('> See `bench/scripts/bundled-size.ts` for methodology.')
  lines.push('')
  lines.push('| Library | Version | Raw | Gzip | Modules |')
  lines.push('|---------|---------|----:|-----:|--------:|')

  for (const entry of report.entries) {
    lines.push(`| ${entry.library} | ${entry.version} | ${formatBytes(entry.raw)} | ${formatBytes(entry.gzip)} | ${entry.modules} |`)
  }

  lines.push('')

  return lines.join('\n')
}

// --- Main ---

const BASE = new URL('../baseline/', import.meta.url).pathname

const bench = await loadJSON<BenchReport>(`${BASE}bench.json`)
const comparison = await loadJSON<BenchReport>(`${BASE}comparison.json`)
const size = await loadJSON<SizeReport>(`${BASE}size.json`)
const bundledSize = await loadJSON<BundledSizeReport>(`${BASE}bundled-size.json`)

const sections: string[] = []

sections.push('# Benchmark results')
sections.push('')
sections.push(`> Generated on ${new Date().toISOString().split('T')[0]}`)
sections.push('')

if (size) {
  sections.push(renderBundleSize(size))
}

if (bundledSize) {
  sections.push(renderBundledSize(bundledSize))
}

if (comparison) {
  sections.push(renderComparison(comparison))
}

if (bench) {
  sections.push(renderCoreBenchmarks(bench))
}

const output = sections.join('\n')
const outPath = new URL('../RESULTS.md', import.meta.url).pathname

await writeFile(outPath, output)
console.log(`Report written to bench/RESULTS.md`)
