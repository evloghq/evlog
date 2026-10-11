import { describe, expect, it } from 'vitest'
import pkg from '../../package.json' with { type: 'json' }
import tsdownConfig from '../../tsdown.config'

/**
 * A public subpath is registered in three places: `package.json#exports`,
 * `package.json#typesVersions`, and `tsdown.config.ts`. A subpath missing from
 * `typesVersions` resolves at runtime and only fails to type-check, so the
 * three must agree. The check starts from `exports`: tsdown also carries
 * internal build entries that are never exported.
 */

const DIST_TYPES = /^\.\/dist\/(.+)\.d\.mts$/

interface Registries {
  exports: Record<string, string | { types?: string }>
  typesVersions: Record<string, string[]>
  tsdownEntries: string[]
}

function registryDrift({ exports, typesVersions, tsdownEntries }: Registries): string[] {
  const problems: string[] = []
  const tsdown = new Set(tsdownEntries)
  const exposed = new Set<string>()

  for (const [subpath, entry] of Object.entries(exports)) {
    if (typeof entry === 'string') continue

    const { types } = entry
    const match = types?.match(DIST_TYPES)
    if (!types || !match) {
      problems.push(`${subpath} in package.json#exports does not point at ./dist/<entry>.d.mts`)
      continue
    }

    const versionsKey = subpath === '.' ? '.' : subpath.slice(2)
    const [, distKey] = match
    exposed.add(versionsKey)

    if (!Object.hasOwn(typesVersions, versionsKey)) {
      problems.push(`${subpath} is in package.json#exports but missing from package.json#typesVersions["*"] (add "${versionsKey}")`)
    } else if (JSON.stringify(typesVersions[versionsKey]) !== JSON.stringify([types])) {
      problems.push(`package.json#typesVersions["*"]["${versionsKey}"] must be ["${types}"]`)
    }

    if (!tsdown.has(distKey)) {
      problems.push(`${subpath} builds to dist/${distKey} but tsdown.config.ts has no entry "${distKey}"`)
    }
  }

  for (const versionsKey of Object.keys(typesVersions)) {
    if (!exposed.has(versionsKey)) {
      problems.push(`package.json#typesVersions["*"]["${versionsKey}"] has no matching package.json#exports entry`)
    }
  }

  return problems
}

describe('entrypoint registries', () => {
  it('package.json#exports, typesVersions and tsdown.config.ts agree', () => {
    expect(registryDrift({
      exports: pkg.exports,
      typesVersions: pkg.typesVersions['*'],
      tsdownEntries: Object.keys(tsdownConfig.entry ?? {}),
    })).toEqual([])
  })

  const aligned: Registries = {
    exports: { '.': { types: './dist/index.d.mts' }, './new': { types: './dist/new.d.mts' } },
    typesVersions: { '.': ['./dist/index.d.mts'], 'new': ['./dist/new.d.mts'] },
    tsdownEntries: ['index', 'new'],
  }

  it.each([
    [
      'typesVersions',
      { ...aligned, typesVersions: { '.': ['./dist/index.d.mts'] } },
      './new is in package.json#exports but missing from package.json#typesVersions["*"] (add "new")'
    ],
    [
      'tsdown.config.ts',
      { ...aligned, tsdownEntries: ['index'] },
      './new builds to dist/new but tsdown.config.ts has no entry "new"'
    ],
    [
      'exports',
      { ...aligned, exports: { '.': { types: './dist/index.d.mts' } } },
      'package.json#typesVersions["*"]["new"] has no matching package.json#exports entry'
    ],
  ])('names the registry missing a subpath (%s)', (_registry, drift, message) => {
    expect(registryDrift(drift)).toEqual([message])
  })

  it('keeps the aligned fixture clean', () => {
    expect(registryDrift(aligned)).toEqual([])
  })
})
