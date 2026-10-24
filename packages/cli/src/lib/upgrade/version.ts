import { parseSync } from 'oxc-parser'
import type { Node } from 'oxc-parser'
import { createLineIndex } from '../map/parse'
import { docsUrlFor } from './docs'
import type { UpgradeFinding } from './types'

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const

/**
 * The lowest major a dependency range allows, or `null` when the range does not
 * name a version (`workspace:*`, `catalog:`, `latest`, a path or a URL).
 */
export function majorOfRange(range: string): number | null {
  const version = range.startsWith('npm:') ? range.slice(range.lastIndexOf('@') + 1) : range
  if (/^(?:workspace|catalog|link|file|git|github|https?):/.test(version)) return null
  const match = version.match(/\d+/)
  return match ? Number(match[0]) : null
}

/** The evlog ranges `package.json` declares, field by field. */
export function declaredEvlogRanges(packageJson: Record<string, unknown>): string[] {
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const range = (packageJson[field] as Record<string, unknown> | undefined)?.evlog
    return typeof range === 'string' ? [range] : []
  })
}

/**
 * The major `evlog upgrade` starts from: the lowest one `package.json` allows,
 * else the installed version's.
 *
 * The declared range wins over `node_modules` because `--write` bumps it
 * before anyone reinstalls: a second run then sees the new major and does
 * nothing, instead of migrating already-migrated code again.
 */
export function startingMajor(packageJson: Record<string, unknown> | null, installedVersion: string | undefined): number | null {
  const majors = declaredEvlogRanges(packageJson ?? {}).map(majorOfRange).filter(major => major !== null)
  if (majors.length > 0) return Math.min(...majors)
  return installedVersion ? majorOfRange(installedVersion) : null
}

/** The range written for `major`. A prerelease CLI targets the major's prereleases too. */
export function targetRange(major: number, prerelease: boolean): string {
  return prerelease ? `^${major}.0.0-0` : `^${major}.0.0`
}

/**
 * Findings that move every evlog range below `to` in `package.json` to `to`.
 * A range that names no version is reported: it is defined somewhere else.
 */
export function bumpEvlogRange(file: string, source: string, to: number, prerelease: boolean): UpgradeFinding[] {
  const id = `v${to}/evlog-version`
  const docsUrl = docsUrlFor(id)
  const lines = createLineIndex(source)
  const next = targetRange(to, prerelease)

  return evlogRangeLiterals(source).flatMap(({ range, start }): UpgradeFinding[] => {
    const major = majorOfRange(range)
    if (major !== null && major >= to) return []
    const loc = lines.locAt(start)
    if (major === null) {
      return [{ id, file, ...loc, mode: 'report', message: `evlog is declared as "${range}": set it to ${next} where that range is defined`, docsUrl, edits: [] }]
    }
    return [{ id, file, ...loc, mode: 'auto', message: `evlog ${range} → ${next}`, docsUrl, edits: [{ start, end: start + range.length, text: next }] }]
  })
}

/**
 * Every `"evlog": "<range>"` inside a dependency field, with the offset of the
 * range text. Parsed as an expression for the offsets, so a script or a config
 * key named `evlog` is never mistaken for the dependency.
 */
function evlogRangeLiterals(source: string): Array<{ range: string, start: number }> {
  const { program } = parseSync('package.json.ts', `(${source})`, { sourceType: 'module', lang: 'ts', preserveParens: false })
  const [statement] = program.body
  const root = statement?.type === 'ExpressionStatement' ? statement.expression : null
  if (root?.type !== 'ObjectExpression') return []
  const found: Array<{ range: string, start: number }> = []
  for (const field of root.properties) {
    if (!isKeyed(field, DEPENDENCY_FIELDS) || field.value.type !== 'ObjectExpression') continue
    for (const dependency of field.value.properties) {
      if (!isKeyed(dependency, ['evlog']) || dependency.value.type !== 'Literal') continue
      const { value } = dependency.value
      if (typeof value === 'string') found.push({ range: value, start: dependency.value.start })
    }
  }
  return found
}

function isKeyed(node: Node, keys: readonly string[]): node is Extract<Node, { type: 'Property' }> {
  return node.type === 'Property' && node.key.type === 'Literal' && keys.includes(String(node.key.value))
}
