import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileAction } from './wiring'

/** What one file would become under `--dry-run`, as a unified diff. */
export interface FilePreview {
  file: string
  kind: 'create' | 'patch'
  /** Unified diff hunks, each line prefixed with ` `, `-`, `+` or `@@`. */
  lines: string[]
  /** Who makes the change when it is not `init` itself, such as `pnpm add evlog`. */
  by?: string
}

/**
 * Unified diff of two texts, line by line, with `context` unchanged lines
 * around each change. Init's files are small, so a plain LCS table is enough.
 */
export function unifiedDiff(before: string, after: string, context = 3): string[] {
  const a = splitLines(before)
  const b = splitLines(after)

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const ops: { op: ' ' | '-' | '+', line: string }[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ op: ' ', line: a[i]! })
      i++
      j++
    } else if (i < a.length && (j === b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      ops.push({ op: '-', line: a[i]! })
      i++
    } else {
      ops.push({ op: '+', line: b[j]! })
      j++
    }
  }

  const changed = ops.flatMap((entry, index) => entry.op === ' ' ? [] : [index])
  if (changed.length === 0) return []

  // Group changes whose context windows touch into one hunk.
  const hunks: [number, number][] = []
  for (const index of changed) {
    const start = Math.max(0, index - context)
    const end = Math.min(ops.length, index + context + 1)
    const last = hunks.at(-1)
    if (last && start <= last[1]) last[1] = end
    else hunks.push([start, end])
  }

  const lines: string[] = []
  for (const [start, end] of hunks) {
    const before = ops.slice(0, start)
    const slice = ops.slice(start, end)
    const oldStart = before.filter(entry => entry.op !== '+').length
    const newStart = before.filter(entry => entry.op !== '-').length
    const oldCount = slice.filter(entry => entry.op !== '+').length
    const newCount = slice.filter(entry => entry.op !== '-').length
    lines.push(`@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`)
    lines.push(...slice.map(entry => `${entry.op}${entry.line}`))
  }
  return lines
}

/** `start,count` the way `diff -u` writes it: an empty side starts at 0. */
function range(start: number, count: number): string {
  return `${count === 0 ? start : start + 1},${count}`
}

function splitLines(text: string): string[] {
  if (text === '') return []
  return text.replace(/\n$/, '').split('\n')
}

/** The diff of each file the plan writes, against what is on disk now. */
export function previewActions(actions: readonly FileAction[]): FilePreview[] {
  return actions.map(action => ({
    file: action.relative,
    kind: action.kind,
    lines: unifiedDiff(action.kind === 'patch' ? readFileSync(action.path, 'utf8') : '', action.contents),
  }))
}

/**
 * The `package.json` the install command leaves behind, with each package
 * under `dependencies` at the tag it is installed from. The package manager
 * writes the version that tag resolves to.
 */
export function previewInstall(packageDir: string, specs: readonly string[], command: string): FilePreview {
  const path = join(packageDir, 'package.json')
  const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const pkg = (source ? JSON.parse(source) : {}) as { dependencies?: Record<string, string> }
  const dependencies = { ...pkg.dependencies }
  for (const spec of specs) {
    const at = spec.lastIndexOf('@')
    const [name, tag] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, 'latest']
    dependencies[name] = tag
  }
  pkg.dependencies = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a < b ? -1 : 1))

  const indent = /^[ \t]+(?=")/m.exec(source)?.[0] ?? '  '
  const after = `${JSON.stringify(pkg, null, indent)}${source === '' || source.endsWith('\n') ? '\n' : ''}`
  return { file: 'package.json', kind: source ? 'patch' : 'create', lines: unifiedDiff(source, after), by: command }
}
