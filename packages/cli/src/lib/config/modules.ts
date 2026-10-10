import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']

/** Conditions read from `exports`, in order. `types` is left out on purpose: a `.d.ts` has no values to read. */
const CONDITIONS = ['import', 'module', 'default', 'node', 'require']

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

/**
 * The file an import path points at, trying the spellings TypeScript accepts:
 * the path as written, `.js` standing for `.ts`, an added extension, and an
 * `index` file.
 */
function resolveFile(base: string): string | null {
  const candidates = [base]
  const js = /\.([mc]?)js$/.exec(base)
  if (js) candidates.push(`${base.slice(0, -js[0].length)}.${js[1]}ts`)
  for (const ext of EXTENSIONS) candidates.push(`${base}${ext}`)
  for (const ext of EXTENSIONS) candidates.push(join(base, `index${ext}`))
  return candidates.find(isFile) ?? null
}

/** `@acme/preset/strict` → `@acme/preset` and `./strict`. */
function splitSpecifier(specifier: string): { name: string, subpath: string } {
  const parts = specifier.split('/')
  const size = specifier.startsWith('@') ? 2 : 1
  const rest = parts.slice(size).join('/')
  return { name: parts.slice(0, size).join('/'), subpath: rest ? `./${rest}` : '.' }
}

function pickCondition(entry: unknown): string | null {
  if (typeof entry === 'string') return entry
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const target = pickCondition(item)
      if (target) return target
    }
    return null
  }
  if (typeof entry !== 'object' || entry === null) return null
  const conditions = entry as Record<string, unknown>
  for (const condition of CONDITIONS) {
    if (!(condition in conditions)) continue
    const target = pickCondition(conditions[condition])
    if (target) return target
  }
  return null
}

interface PackageManifest {
  exports?: unknown
  module?: string
  main?: string
}

/** The file a package exposes for `subpath`, following `exports` when the package declares it. */
function packageTarget(manifest: PackageManifest, subpath: string): string | null {
  const { exports } = manifest
  if (exports === undefined) {
    if (subpath !== '.') return subpath
    return manifest.module ?? manifest.main ?? 'index.js'
  }
  const isSubpathMap = typeof exports === 'object' && exports !== null && !Array.isArray(exports)
    && Object.keys(exports).some(key => key.startsWith('.'))
  if (isSubpathMap) return pickCondition((exports as Record<string, unknown>)[subpath])
  return subpath === '.' ? pickCondition(exports) : null
}

function resolvePackage(specifier: string, fromDir: string): string | null {
  const { name, subpath } = splitSpecifier(specifier)
  let dir = fromDir
  for (;;) {
    const packageDir = join(dir, 'node_modules', name)
    const manifestPath = join(packageDir, 'package.json')
    if (isFile(manifestPath)) {
      const target = packageTarget(JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest, subpath)
      return target ? resolveFile(join(packageDir, target)) : null
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Whether an import specifier is a path rather than a package name. */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || isAbsolute(specifier)
}

/**
 * The source file an import specifier refers to, from `fromDir`, or `null`.
 *
 * A package is found by walking up `node_modules` and reading its manifest
 * rather than through `require.resolve`: an ESM-only package that exports no
 * `require` condition cannot be resolved that way, and `import.meta.resolve`
 * takes no parent outside an experimental flag.
 */
export function resolveModuleFile(specifier: string, fromDir: string): string | null {
  if (isRelativeSpecifier(specifier)) return resolveFile(resolve(fromDir, specifier))
  return resolvePackage(specifier, fromDir)
}
