/**
 * Bundle-size budget.
 *
 * Bundles each scenario in bench/scenarios/ against the built dist/ with
 * esbuild (minified, ESM, node, code splitting) and gzips what loads at
 * startup: the entry chunk and the chunks it imports statically. Chunks behind
 * a dynamic `import()` load on demand, so they are reported apart as lazy. It
 * also measures the unpacked size of the published files. Each number is checked against
 * bench/baseline/size-budget.json, which also records the evlog@2.35.1
 * numbers measured the same way as the reference to stay under.
 *
 * test/build/size-budget.test.ts enforces the budget; this script prints it.
 *
 * Usage:
 *   tsx bench/scripts/size-budget.ts             # print a Markdown table, exit 1 over budget
 *
 * Requires a built dist/ (pnpm run dev:prepare).
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import budget from '../baseline/size-budget.json' with { type: 'json' }

export interface ScenarioSize {
  scenario: string
  /** Minified bytes loaded at startup. */
  minified: number
  /** Gzipped bytes loaded at startup, each chunk compressed on its own. */
  gzip: number
  /** Minified bytes of the chunks behind a dynamic `import()`. */
  lazy: number
  /** Input files with code in the startup chunks, relative to the package root. */
  modules: string[]
}

export interface Budget {
  reference: string
  scenarios: Record<string, { gzip: number, reference: number }>
  unpacked: { bytes: number, reference: number }
}

const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url))
const SCENARIOS_DIR = fileURLToPath(new URL('../scenarios/', import.meta.url))

export const sizeBudget: Budget = budget

export async function measureScenarios(): Promise<ScenarioSize[]> {
  const sizes: ScenarioSize[] = []

  for (const file of readdirSync(SCENARIOS_DIR).sort()) {
    const result = await build({
      entryPoints: [`${SCENARIOS_DIR}${file}`],
      bundle: true,
      splitting: true,
      minify: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      // The framework itself is the app's cost, not evlog's.
      external: ['hono', 'hono/*'],
      // The package tsconfig maps `evlog` to src/; resolve through `exports` to dist/ like an app does.
      tsconfigRaw: {},
      absWorkingDir: PACKAGE_DIR,
      metafile: true,
      write: false,
      outdir: 'size-budget',
      logLevel: 'error',
    })

    const { outputs } = result.metafile
    const entry = Object.keys(outputs).find(path => outputs[path]!.entryPoint)
    if (!entry) throw new Error(`esbuild produced no entry chunk for ${file}`)
    const startup = new Set<string>()
    const pending = [entry]
    while (pending.length > 0) {
      const path = pending.pop()!
      if (startup.has(path)) continue
      startup.add(path)
      for (const imported of outputs[path]!.imports) {
        if (imported.kind === 'import-statement' && !imported.external) pending.push(imported.path)
      }
    }

    let minified = 0
    let gzip = 0
    let lazy = 0
    for (const output of result.outputFiles) {
      const path = Object.keys(outputs).find(key => output.path.endsWith(key))
      if (path && startup.has(path)) {
        minified += output.contents.byteLength
        gzip += gzipSync(output.contents).byteLength
      } else {
        lazy += output.contents.byteLength
      }
    }

    sizes.push({
      scenario: file.replace(/\.ts$/, ''),
      minified,
      gzip,
      lazy,
      modules: [...startup].flatMap(path => Object.keys(outputs[path]!.inputs)),
    })
  }

  return sizes
}

/** Unpacked size of the tarball `pnpm publish` would upload: the sum of its file entries. */
export function measureUnpacked(): number {
  const destination = mkdtempSync(join(tmpdir(), 'evlog-pack-'))
  try {
    const output = execFileSync('pnpm', ['pack', '--pack-destination', destination, '--json'], { cwd: PACKAGE_DIR, encoding: 'utf8' })
    const { filename } = JSON.parse(output) as { filename: string }
    const tar = gunzipSync(readFileSync(filename))
    let total = 0
    let offset = 0
    // ustar: a 512-byte header per entry (size in octal at offset 124, type at 156), then the data padded to 512.
    while (offset + 512 <= tar.length && tar[offset] !== 0) {
      const size = Number.parseInt(tar.subarray(offset + 124, offset + 136).toString('ascii').trim(), 8)
      if (tar[offset + 156] === 0x30 || tar[offset + 156] === 0) total += size
      offset += 512 + Math.ceil(size / 512) * 512
    }
    return total
  } finally {
    rmSync(destination, { recursive: true })
  }
}

function delta(value: number, against: number): string {
  const diff = value - against
  const percent = ((diff / against) * 100).toFixed(1)
  return `${diff > 0 ? '+' : ''}${diff} (${diff > 0 ? '+' : ''}${percent}%)`
}

async function run(): Promise<void> {
  const scenarios = await measureScenarios()
  const unpacked = measureUnpacked()
  let over = false

  const lines = [
    `| Scenario | Minified | Gzip | Budget | vs ${sizeBudget.reference} | Lazy (minified) |`,
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const { scenario, minified, gzip, lazy } of scenarios) {
    const limit = sizeBudget.scenarios[scenario]
    if (!limit) throw new Error(`No budget for scenario ${scenario} in bench/baseline/size-budget.json`)
    const status = gzip > limit.gzip ? ' over' : ''
    over ||= gzip > limit.gzip
    lines.push(`| ${scenario} | ${minified} | ${gzip} | ${limit.gzip}${status} | ${delta(gzip, limit.reference)} | ${lazy} |`)
  }
  over ||= unpacked > sizeBudget.unpacked.bytes
  lines.push(`| unpacked tarball | | ${unpacked} | ${sizeBudget.unpacked.bytes}${unpacked > sizeBudget.unpacked.bytes ? ' over' : ''} | ${delta(unpacked, sizeBudget.unpacked.reference)} | |`)

  console.log('### Bundle size')
  console.log('')
  console.log('Bytes. Scenarios are bundled from `bench/scenarios/` with esbuild (minified, ESM, node22, code splitting) and count what loads at startup; the unpacked size sums the files in the `pnpm pack` tarball.')
  console.log('')
  console.log(lines.join('\n'))

  if (over) {
    console.log('')
    console.log('Over budget. Shrink the bundle, or raise the budget in `bench/baseline/size-budget.json` and say why in the pull request.')
    process.exitCode = 1
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) await run()
