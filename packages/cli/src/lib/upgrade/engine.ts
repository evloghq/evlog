import { parseSync } from 'oxc-parser'
import type { Node } from 'oxc-parser'
import { createLineIndex, matchVueScript, walkAst } from '../map/parse'
import type { Codemod, CodemodContext, Edit, Migration, Span, UpgradeFinding } from './types'
import { docsUrlFor } from './docs'
import { bumpEvlogRange } from './version'
import { mergeVisitors } from './visitors'

export interface MigrateInput {
  /** Relative path → contents, for every file that may hold code. */
  files: ReadonlyMap<string, string>
  /** The project's `package.json`, relative path and contents. */
  packageJson: { file: string, source: string } | null
  /** Ordered by `to`. Those at or below `from` are skipped. */
  migrations: readonly Migration[]
  /** The evlog major the project is on. */
  from: number
  /** Write prerelease ranges (`^3.0.0-0`), for a prerelease CLI. */
  prerelease: boolean
}

/** One migration's pass over one file. */
export interface FileStep {
  to: number
  before: string
  after: string
  findings: UpgradeFinding[]
}

export interface MigrateResult {
  from: number
  to: number
  /** Relative path → the passes that found something in it, in migration order. */
  files: Map<string, FileStep[]>
  findings: UpgradeFinding[]
}

/**
 * Run every migration above `from`, in order, over in-memory sources.
 *
 * Pure: the caller reads and writes the files. Each migration parses a file
 * once, runs all its codemods in one walk and applies their edits together;
 * the next migration reads the result.
 */
export function migrate(input: MigrateInput): MigrateResult {
  const current = new Map(input.files)
  if (input.packageJson) current.set(input.packageJson.file, input.packageJson.source)
  const files = new Map<string, FileStep[]>()
  const pending = input.migrations.filter(migration => migration.to > input.from)

  for (const migration of pending) {
    for (const [file, before] of current) {
      const findings = file === input.packageJson?.file
        ? bumpEvlogRange(file, before, migration.to, input.prerelease)
        : runCodemods(migration, file, before)
      if (findings.length === 0) continue
      const after = applyEdits(file, before, findings)
      current.set(file, after)
      files.set(file, [...(files.get(file) ?? []), { to: migration.to, before, after, findings }])
    }
  }

  return { from: input.from, to: pending.at(-1)?.to ?? input.from, files, findings: [...files.values()].flat().flatMap(step => step.findings) }
}

interface ParsedForEdit {
  program: CodemodContext['program']
  code: string
  /** Where `code` starts in the file: non-zero for a Vue `<script>` block. */
  offset: number
  errors: string[]
}

function parseForEdit(file: string, source: string): ParsedForEdit | null {
  const block = file.endsWith('.vue') ? matchVueScript(source) : { code: source, index: 0 }
  if (!block) return null
  const { code, index: offset } = block
  const lang = /\.[jt]sx$/.test(file) ? 'tsx' : 'ts'
  const result = parseSync(file, code, { sourceType: 'module', lang })
  return { program: result.program, code, offset, errors: result.errors.map(error => error.message) }
}

function runCodemods(migration: Migration, file: string, source: string): UpgradeFinding[] {
  const active = migration.codemods.filter(codemod => codemod.needles.some(needle => source.includes(needle)))
  if (active.length === 0) return []
  const parsed = parseForEdit(file, source)
  if (!parsed) return []

  const { program, code, offset } = parsed
  const lines = createLineIndex(source)
  const findings: UpgradeFinding[] = []
  const at = (span: Span) => lines.locAt(span.start + offset)
  const contextFor = (codemod: Codemod): CodemodContext => ({
    file,
    source: code,
    program,
    finding(span, message, edits = []) {
      findings.push({
        id: codemod.id,
        file,
        ...at(span),
        mode: edits.length > 0 ? 'auto' : 'report',
        message,
        docsUrl: docsUrlFor(codemod.id),
        edits: edits.map(edit => ({ start: edit.start + offset, end: edit.end + offset, text: edit.text })),
      })
    },
  })

  if (parsed.errors.length > 0) {
    const id = `v${migration.to}/unparsed`
    const loc = at({ start: 0, end: 0 })
    findings.push({
      id,
      file,
      ...loc,
      mode: 'report',
      message: `could not parse this file, so it was not checked: ${parsed.errors[0]}`,
      docsUrl: docsUrlFor(id),
      edits: [],
    })
    return findings
  }

  const visitor = mergeVisitors(active.map(codemod => codemod.create(contextFor(codemod))))
  const listeners = visitor as Record<string, ((node: Node, parent: Node | null) => void) | undefined>
  walkAst(program, (node, parent) => listeners[node.type]?.(node, parent))
  visitor.onEnd?.()
  return findings
}

/**
 * Apply every finding's edits in one pass.
 *
 * Two edits on the same code mean two codemods disagree about it, and picking
 * one would hide the other's bug, so that throws.
 */
export function applyEdits(file: string, source: string, findings: readonly UpgradeFinding[]): string {
  const edits = findings
    .flatMap(finding => finding.edits.map(edit => ({ ...edit, id: finding.id })))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  let out = ''
  let cursor = 0
  let previous: (Edit & { id: string }) | undefined
  for (const edit of edits) {
    if (previous && edit.start < previous.end) {
      throw new Error(`upgrade: ${previous.id} and ${edit.id} both edit ${file} at offset ${edit.start}`)
    }
    out += source.slice(cursor, edit.start) + edit.text
    cursor = edit.end
    previous = edit
  }
  return out + source.slice(cursor)
}
