import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { findPackage, isRelativeSpecifier, packageEntry, packageSubpaths, resolveModuleFile } from '../config/modules'
import { buildFileFacts } from './facts'
import { parseFile } from './parse'

const SOURCE_FILE = /\.[mc]?[jt]sx?$/

/**
 * The names a module forwards from evlog, following its relative re-exports.
 *
 * A package entry is usually an `index.ts` that re-exports the file calling
 * `createEvlog`, so reading the entry alone would find nothing. `cache` also
 * guards against re-exports that loop: a module already being read counts as
 * forwarding nothing until it is done. That leaves the other modules in the
 * loop incomplete, so each entry is read with a cache of its own.
 */
function forwardedNames(file: string, cache: Map<string, Set<string>>): ReadonlySet<string> {
  const cached = cache.get(file)
  if (cached) return cached
  const names = new Set<string>()
  cache.set(file, names)

  const parsed = parseFile(file)
  if (!parsed) return names
  const facts = buildFileFacts(parsed)
  for (const name of facts.reexportsEvlog) names.add(name)

  for (const { source, names: specifiers } of facts.reexports) {
    if (!isRelativeSpecifier(source)) continue
    const target = resolveModuleFile(source, dirname(file))
    if (!target) continue
    const inner = forwardedNames(target, cache)
    for (const [exported, imported] of specifiers) {
      if (imported === '*') {
        for (const name of inner) names.add(name)
      } else if (inner.has(imported) || inner.has('*')) {
        names.add(exported)
      }
    }
  }
  return names
}

/**
 * Installed dependencies that wrap evlog, by the specifier each entry is
 * imported with, and the evlog names that entry forwards.
 *
 * Teams put evlog behind a shared package (`@acme/logger`) that calls
 * `createEvlog` with their drains and defaults, and apps import only that
 * package. A dependency qualifies when it declares evlog and evlog resolves
 * from its real location: under pnpm that is where its own `node_modules`
 * sits, not the app's.
 */
export function collectEvlogPackages(
  projectRoot: string,
  dependencies: ReadonlySet<string>,
): Map<string, ReadonlySet<string>> {
  const packages = new Map<string, ReadonlySet<string>>()

  for (const name of dependencies) {
    if (name === 'evlog') continue
    const pkg = findPackage(name, projectRoot)
    if (!pkg) continue
    const declared = { ...pkg.manifest.dependencies, ...pkg.manifest.peerDependencies }
    if (!('evlog' in declared)) continue
    if (!findPackage('evlog', realpathSync(pkg.dir))) continue

    for (const subpath of packageSubpaths(pkg.manifest)) {
      const entry = packageEntry(pkg, subpath)
      if (!entry || !SOURCE_FILE.test(entry)) continue
      const names = forwardedNames(entry, new Map())
      if (names.size === 0) continue
      packages.set(subpath === '.' ? name : `${name}${subpath.slice(1)}`, names)
    }
  }
  return packages
}
