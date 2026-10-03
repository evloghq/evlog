import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { glob } from '../glob'
import { buildFileFacts, moduleKey } from './facts'
import type { FileFacts } from './facts'
import { parseSource } from './parse'
import type { ScanContext } from './types'

/**
 * An evlog feature the project has already adopted somewhere.
 *
 * Adoption is the whole point: suggesting a feature nobody asked for is
 * lecturing, whereas suggesting more of a feature the team already chose is
 * useful. Nothing here ever affects the score.
 */
export type EvlogFeature = 'error-catalog' | 'audit' | 'ai' | 'better-auth' | 'client-logging'

/** Third-party packages worth pairing with an evlog integration. */
export type PairablePackage = 'ai' | 'better-auth'

/** The same inline error, written out in more than one file. */
export interface RepeatedError {
  /** Short human label, e.g. `402 Card declined`. */
  label: string
  /** Project-relative files it appears in, sorted. */
  files: readonly string[]
}

export interface ProjectFacts {
  /** Direct dependencies and devDependencies. */
  dependencies: ReadonlySet<string>
  /** evlog features with evidence of use somewhere in the project. */
  features: ReadonlySet<EvlogFeature>
  /** Third-party packages present that evlog has an integration for. */
  pairable: ReadonlySet<PairablePackage>
  /** Error catalogs already declared, by name — so a suggestion can name one. */
  catalogs: readonly string[]
  /**
   * Local modules that re-export evlog, keyed by {@link moduleKey}.
   *
   * Collected project-wide because the module that re-exports evlog is never the
   * handler being scored: without this, evlog's own recommended Next.js shape
   * (`import { useLogger } from '@/lib/evlog'`) scored as uninstrumented.
   */
  evlogBarrels: ReadonlyMap<string, ReadonlySet<string>>
  /**
   * Inline errors duplicated across files, by signature.
   *
   * This is the only evidence that justifies bringing up error catalogs: one
   * inline error is a local decision, the same one in three handlers is a
   * catalog entry that has not been written yet.
   */
  repeatedErrors: ReadonlyMap<string, RepeatedError>
}

/**
 * Marker → feature, checked against raw source before parsing.
 *
 * The marker is only a prefilter: a file that contains the text is parsed and
 * confirmed against the AST, so a mention inside a comment or a string does not
 * count as adoption.
 */
const FEATURE_MARKERS: Record<EvlogFeature, string> = {
  'error-catalog': 'defineErrorCatalog',
  'audit': 'audit(',
  'ai': 'evlog/ai',
  'better-auth': 'evlog/better-auth',
  'client-logging': 'evlog/client',
}

const PAIRABLE_PACKAGES: readonly PairablePackage[] = ['ai', 'better-auth']

/**
 * Source files worth searching for adoption evidence.
 *
 * The extension list tracks what the adapters scan — a catalog declared in a
 * `.mjs` or `.cts` barrel would otherwise be invisible here, and every handler
 * importing it would be scored as if the project had no catalog at all.
 */
const SOURCE_GLOBS = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue}']

/** Confirm a marker against the AST rather than trusting the text match. */
function confirmFeature(feature: EvlogFeature, facts: FileFacts): boolean {
  switch (feature) {
    case 'error-catalog':
      return facts.callsTo('defineErrorCatalog').length > 0
    case 'audit':
      return facts.loggerCalls('audit').length > 0 || facts.evlogWrappers.has('withAudit')
    case 'ai':
      return facts.evlogImports.has('evlog/ai')
    case 'better-auth':
      return facts.evlogImports.has('evlog/better-auth')
    case 'client-logging':
      return facts.evlogImports.has('evlog/client')
  }
}

/**
 * What the project has already adopted, collected once per scan.
 *
 * Adoption evidence has to be project-wide, not per-file: an error catalog is
 * declared in one shared module and used from many handlers, so a per-file view
 * would never see it.
 */
export function collectProjectFacts(
  ctx: ScanContext,
  options: { packageJson: unknown, evlogAutoImports?: readonly string[] },
): ProjectFacts {
  const dependencies = readDependencies(options.packageJson)
  const features = new Set<EvlogFeature>()
  const pending = new Set(Object.keys(FEATURE_MARKERS) as EvlogFeature[])
  const catalogs = new Set<string>()
  const errors = new Map<string, { label: string, files: Set<string> }>()
  const evlogBarrels = new Map<string, Set<string>>()

  const files = glob(SOURCE_GLOBS, ctx.projectRoot)

  for (const file of files) {
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    /* Text prefilter before parsing: most files match nothing here, and parsing
       every file in a large app to answer four questions would not be worth it. */
    const markers = [...pending].filter(feature => source.includes(FEATURE_MARKERS[feature]))
    const mayDeclareErrors = source.includes('createError(') || source.includes('defineErrorCatalog')
    const mayReexport = source.includes('export') && source.includes('evlog')
    if (markers.length === 0 && !mayDeclareErrors && !mayReexport) continue

    const parsed = parseSource(file, source)
    if (!parsed) continue
    const facts = buildFileFacts(parsed, { evlogAutoImports: options.evlogAutoImports })

    for (const feature of markers) {
      if (!confirmFeature(feature, facts)) continue
      features.add(feature)
      pending.delete(feature)
    }
    for (const name of facts.catalogsDeclared) catalogs.add(name)

    if (facts.reexportsEvlog.size > 0) {
      const key = moduleKey(relative(ctx.projectRoot, file))
      const forwarded = evlogBarrels.get(key) ?? new Set<string>()
      for (const name of facts.reexportsEvlog) forwarded.add(name)
      evlogBarrels.set(key, forwarded)
    }

    const relativePath = relative(ctx.projectRoot, file)
    for (const error of facts.inlineErrors) {
      const entry = errors.get(error.signature)
      if (entry) entry.files.add(relativePath)
      else errors.set(error.signature, { label: error.label, files: new Set([relativePath]) })
    }
  }

  const repeatedErrors = new Map<string, RepeatedError>()
  for (const [signature, entry] of errors) {
    if (entry.files.size < 2) continue
    repeatedErrors.set(signature, { label: entry.label, files: [...entry.files].sort() })
  }

  const pairable = new Set(PAIRABLE_PACKAGES.filter(pkg => dependencies.has(pkg)))

  return {
    dependencies,
    features,
    pairable,
    catalogs: [...catalogs].sort(),
    evlogBarrels,
    repeatedErrors,
  }
}

function readDependencies(packageJson: unknown): Set<string> {
  const manifest = packageJson as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  } | null
  return new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ])
}

/** Read the project manifest, or `null` when it is missing or malformed. */
export function readPackageJson(projectRoot: string): unknown {
  try {
    return JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}
