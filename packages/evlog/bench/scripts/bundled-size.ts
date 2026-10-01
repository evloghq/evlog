/**
 * Bundled-size comparison script.
 *
 * Bundles the canonical basic setup of evlog, consola, pino and winston
 * (bench/bundled/<library>.ts) with esbuild, minifies, gzips the output and
 * reports raw bytes, gzip bytes and bundled module counts, with the installed
 * version of each library. Unlike size.ts, which reads dist/ files directly,
 * the measurement is a real bundle: tree-shaking, minification and shared
 * chunks all apply.
 *
 * Usage:
 *   tsx bench/scripts/bundled-size.ts              # print table
 *   tsx bench/scripts/bundled-size.ts --json       # output JSON
 *   tsx bench/scripts/bundled-size.ts --write      # save to bench/baseline/bundled-size.json
 *
 * Resolving the `evlog` import requires a built dist/ (pnpm run dev:prepare).
 */

import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

interface BundledEntry {
  library: string
  version: string
  raw: number
  gzip: number
  modules: number
}

export interface BundledSizeReport {
  bundler: { name: 'esbuild', version: string }
  options: { platform: string, format: string, target: string, minify: boolean }
  entries: BundledEntry[]
}

const LIBRARIES = ['evlog', 'consola', 'pino', 'winston'] as const
const FIXTURES_DIR = new URL('../bundled/', import.meta.url)
const BASELINE_PATH = new URL('../baseline/bundled-size.json', import.meta.url)

const BUNDLER_OPTIONS = { platform: 'node', format: 'esm', target: 'node18', minify: true } as const

const require = createRequire(import.meta.url)

/**
 * Version of an installed package. Some exports maps (consola) do not expose
 * ./package.json, so resolve the package entry and walk up to its root.
 */
function pkgVersion(name: string): string {
  let dir = dirname(require.resolve(name))
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string, version: string }
      if (pkg.name === name) return pkg.version
    }
    dir = dirname(dir)
  }
  throw new Error(`Could not resolve the installed version of ${name}`)
}

export async function measureBundledSize(): Promise<BundledSizeReport> {
  const evlogPkg = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
  const versions: Record<string, string> = { evlog: evlogPkg.version }
  for (const library of ['consola', 'pino', 'winston'] as const) {
    versions[library] = pkgVersion(library)
  }

  const entries: BundledEntry[] = []

  for (const library of LIBRARIES) {
    const result = await build({
      entryPoints: [fileURLToPath(new URL(`./${library}.ts`, FIXTURES_DIR))],
      ...BUNDLER_OPTIONS,
      bundle: true,
      metafile: true,
      write: false,
      outdir: 'bundled-size',
    })

    for (const warning of result.warnings) {
      console.error(`esbuild warning (${library}): ${warning.text}`)
    }

    if (!result.outputFiles?.length) throw new Error(`esbuild produced no output for ${library}`)
    if (!result.metafile) throw new Error(`esbuild returned no metafile for ${library}`)

    const raw = result.outputFiles.reduce((total, file) => total + file.contents.byteLength, 0)
    const gzip = result.outputFiles.reduce((total, file) => total + gzipSync(file.contents).byteLength, 0)

    entries.push({
      library,
      version: versions[library]!,
      raw,
      gzip,
      modules: Object.keys(result.metafile.inputs).length,
    })
  }

  entries.sort((a, b) => a.gzip - b.gzip)

  return {
    bundler: { name: 'esbuild', version: pkgVersion('esbuild') },
    options: { ...BUNDLER_OPTIONS },
    entries,
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(2)} kB`
}

async function run(): Promise<void> {
  const report = await measureBundledSize()

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('')
    console.log('  Bundled Size vs Alternatives')
    console.log('  ============================')
    console.log('')
    console.log('  Library                    Version     Raw         Gzip    Modules')
    console.log('  ─────────────────────────────────────────────────────────────────────')

    for (const entry of report.entries) {
      const library = entry.library.padEnd(24)
      const version = entry.version.padEnd(11)
      const raw = formatBytes(entry.raw).padStart(10)
      const gzip = formatBytes(entry.gzip).padStart(8)
      const modules = String(entry.modules).padStart(9)
      console.log(`  ${library} ${version} ${raw}   ${gzip}   ${modules}`)
    }

    console.log('')
  }

  if (process.argv.includes('--write')) {
    await writeFile(BASELINE_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log('Written to bench/baseline/bundled-size.json')
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) await run()
