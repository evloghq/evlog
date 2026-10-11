import { describe, expect, it } from 'vitest'
import pkg from '../../package.json' with { type: 'json' }
import tsdownConfig from '../../tsdown.config'

const DIST_TYPES = /^\.\/dist\/(.+)\.d\.mts$/

type ExportEntry = string | { types?: string, import?: string, default?: string }

interface Registries {
  exports: Record<string, ExportEntry>
  typesVersions: Record<string, string[]>
  tsdownEntries: string[]
}

/**
 * Lists every disagreement between `package.json#exports`, `typesVersions["*"]` and `tsdown.config.ts`.
 * A tsdown entry with no export is an internal chunk, so the walk starts from `exports`.
 */
function registryDrift({ exports, typesVersions, tsdownEntries }: Registries): string[] {
  const problems: string[] = []
  const tsdown = new Set(tsdownEntries)
  const exposed = new Set<string>()

  for (const [subpath, entry] of Object.entries(exports)) {
    if (typeof entry === 'string') {
      if (subpath !== './package.json') {
        problems.push(`${subpath} in package.json#exports is a string, expected { types, import, default }`)
      }
      continue
    }

    const { types } = entry
    const match = types?.match(DIST_TYPES)
    if (!types || !match) {
      problems.push(`${subpath} in package.json#exports does not point at ./dist/<entry>.d.mts`)
      continue
    }

    const versionsKey = subpath === '.' ? '.' : subpath.slice(2)
    const [, distKey] = match
    const js = `./dist/${distKey}.mjs`
    exposed.add(versionsKey)

    for (const condition of ['import', 'default'] as const) {
      const target = entry[condition]
      if (target === undefined) {
        problems.push(`${subpath} in package.json#exports has no ${condition} condition, expected "${js}"`)
      } else if (target !== js) {
        problems.push(`${subpath} in package.json#exports has ${condition} "${target}", expected "${js}" to match its types`)
      }
    }

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

function namedEntries(entry: typeof tsdownConfig.entry): string[] {
  if (!entry || typeof entry === 'string' || Array.isArray(entry)) {
    throw new TypeError('tsdown.config.ts must declare entry as an object of named entries')
  }
  return Object.keys(entry)
}

function distEntry(key: string) {
  return { types: `./dist/${key}.d.mts`, import: `./dist/${key}.mjs`, default: `./dist/${key}.mjs` }
}

describe('entrypoint registries', () => {
  it('package.json#exports, typesVersions and tsdown.config.ts agree', () => {
    expect(registryDrift({
      exports: pkg.exports,
      typesVersions: pkg.typesVersions['*'],
      tsdownEntries: namedEntries(tsdownConfig.entry),
    })).toEqual([])
  })

  const aligned: Registries = {
    exports: { '.': distEntry('index'), './package.json': './package.json', './new': distEntry('new') },
    typesVersions: { '.': ['./dist/index.d.mts'], 'new': ['./dist/new.d.mts'] },
    tsdownEntries: ['index', 'new'],
  }

  it('keeps the aligned fixture clean', () => {
    expect(registryDrift(aligned)).toEqual([])
  })

  it.each([
    [
      'missing from typesVersions',
      { ...aligned, typesVersions: { '.': ['./dist/index.d.mts'] } },
      ['./new is in package.json#exports but missing from package.json#typesVersions["*"] (add "new")'],
    ],
    [
      'typesVersions pointing elsewhere',
      { ...aligned, typesVersions: { ...aligned.typesVersions, new: ['./dist/old.d.mts'] } },
      ['package.json#typesVersions["*"]["new"] must be ["./dist/new.d.mts"]'],
    ],
    [
      'missing from tsdown.config.ts',
      { ...aligned, tsdownEntries: ['index'] },
      ['./new builds to dist/new but tsdown.config.ts has no entry "new"'],
    ],
    [
      'missing from exports',
      { ...aligned, exports: { '.': distEntry('index') } },
      ['package.json#typesVersions["*"]["new"] has no matching package.json#exports entry'],
    ],
    [
      'import pointing at another build',
      { ...aligned, exports: { ...aligned.exports, './new': { ...distEntry('new'), import: './dist/old.mjs' } } },
      ['./new in package.json#exports has import "./dist/old.mjs", expected "./dist/new.mjs" to match its types'],
    ],
    [
      'default condition missing',
      { ...aligned, exports: { ...aligned.exports, './new': { types: './dist/new.d.mts', import: './dist/new.mjs' } } },
      ['./new in package.json#exports has no default condition, expected "./dist/new.mjs"'],
    ],
    [
      'subpath declared as a string',
      { ...aligned, exports: { ...aligned.exports, './new': './dist/new.mjs' } },
      [
        './new in package.json#exports is a string, expected { types, import, default }',
        'package.json#typesVersions["*"]["new"] has no matching package.json#exports entry',
      ],
    ],
  ])('reports drift: %s', (_case, drift, messages) => {
    expect(registryDrift(drift)).toEqual(messages)
  })
})
