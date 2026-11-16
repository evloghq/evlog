/**
 * Bundle size measurement script.
 *
 * Measures each `package.json#exports` subpath, so every public entry gets a
 * row: the file it imports plus every dist chunk that file loads through static
 * relative imports, gzipped together. Dynamic imports and dependencies are left
 * out. Outputs a JSON report for tracking and comparison.
 *
 * Usage:
 *   tsx bench/scripts/size.ts                    # print table
 *   tsx bench/scripts/size.ts --json             # output JSON
 *   tsx bench/scripts/size.ts --json > size.json # save to file
 */

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import pkg from '../../package.json' with { type: 'json' }

interface EntrySize {
  entry: string
  raw: number
  gzip: number
}

interface SizeReport {
  entries: EntrySize[]
  total: { raw: number, gzip: number }
}

const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url))

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(2)} kB`
}

const STATIC_RELATIVE_IMPORT = /^(?:import|export)\b(?!\s*\()[^;]*?["'](\.{1,2}\/[^"']+)["']/gm

async function measureEntry(path: string): Promise<{ raw: number, gzip: number }> {
  const files = new Map<string, Buffer>()
  const pending = [path]

  while (pending.length > 0) {
    const file = pending.pop()!
    if (files.has(file)) continue
    const content = await readFile(file)
    files.set(file, content)
    for (const [, specifier] of content.toString('utf8').matchAll(STATIC_RELATIVE_IMPORT)) {
      pending.push(resolve(dirname(file), specifier!))
    }
  }

  const bundle = Buffer.concat([...files.values()])
  return { raw: bundle.byteLength, gzip: gzipSync(bundle).byteLength }
}

async function run(): Promise<void> {
  const entries: EntrySize[] = []

  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (typeof target === 'string') continue
    const { raw, gzip } = await measureEntry(resolve(PACKAGE_DIR, target.import))
    entries.push({ entry: subpath === '.' ? 'evlog' : `evlog/${subpath.slice(2)}`, raw, gzip })
  }

  entries.sort((a, b) => b.gzip - a.gzip)

  const total = entries.reduce(
    (acc, e) => ({ raw: acc.raw + e.raw, gzip: acc.gzip + e.gzip }),
    { raw: 0, gzip: 0 },
  )

  const report: SizeReport = { entries, total }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log('')
  console.log('  Bundle Size Report')
  console.log('  ==================')
  console.log('')
  console.log(`  ${'Entry'.padEnd(34)}        Raw          Gzip`)
  console.log(`  ${'─'.repeat(59)}`)

  for (const entry of entries) {
    const name = entry.entry.padEnd(34)
    const raw = formatBytes(entry.raw).padStart(10)
    const gzip = formatBytes(entry.gzip).padStart(10)
    console.log(`  ${name} ${raw}    ${gzip}`)
  }

  console.log(`  ${'─'.repeat(59)}`)
  console.log(`  ${'Total'.padEnd(34)} ${formatBytes(total.raw).padStart(10)}    ${formatBytes(total.gzip).padStart(10)}`)
  console.log('')
}

run()
