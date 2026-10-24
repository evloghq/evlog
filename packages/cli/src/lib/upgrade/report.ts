import type { Style } from '../../core/output'
import { createLineIndex } from '../map/parse'
import type { MigrateResult } from './engine'
import type { UpgradeReport } from './run'
import type { Edit, UpgradeFinding } from './types'

/**
 * The lines a finding's edits touch, before and after, numbered as in the
 * file the migration read. Edits on overlapping lines share one hunk.
 */
export function hunks(source: string, edits: readonly Edit[]): Array<{ line: number, before: string[], after: string[] }> {
  const lines = createLineIndex(source)
  const sorted = [...edits].sort((a, b) => a.start - b.start)
  const groups: Array<{ start: number, end: number, edits: Edit[] }> = []
  for (const edit of sorted) {
    const start = source.lastIndexOf('\n', edit.start - 1) + 1
    const newline = source.indexOf('\n', edit.end)
    const end = newline === -1 ? source.length : newline
    const last = groups.at(-1)
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end)
      last.edits.push(edit)
    } else {
      groups.push({ start, end, edits: [edit] })
    }
  }
  return groups.map((group) => {
    let after = ''
    let cursor = group.start
    for (const edit of group.edits) {
      after += source.slice(cursor, edit.start) + edit.text
      cursor = edit.end
    }
    after += source.slice(cursor, group.end)
    return { line: lines.lineAt(group.start), before: source.slice(group.start, group.end).split('\n'), after: after.split('\n') }
  })
}

/** The human report: findings grouped by file, each fix with its before and after lines. */
export function formatUpgradeReport(style: Style, report: UpgradeReport, result: MigrateResult): string {
  const { paint } = style
  if (report.findings.length === 0) {
    return report.to > report.from
      ? `evlog ${report.from} → ${report.to}: nothing to change.`
      : `This project is on evlog ${report.from}, the newest major this CLI migrates to. Nothing to do.`
  }

  const out = [paint('bold', `evlog ${report.from} → ${report.to}`) + paint('dim', report.write ? '' : ' · dry run, nothing written'), '']
  for (const [file, steps] of result.files) {
    out.push(paint('bold', file))
    for (const step of steps) {
      for (const finding of step.findings) out.push(...formatFinding(style, step.before, finding))
    }
    out.push('')
  }

  const { auto, report: manual } = report.summary
  const counts = [auto > 0 && `${auto} ${report.write ? 'fixed' : 'to fix'}`, manual > 0 && `${manual} to review`].filter(Boolean).join(', ')
  const next = report.write
    ? auto > 0 ? 'Reinstall dependencies, then run your build and tests.' : ''
    : auto > 0 ? 'Run with --write to apply.' : ''
  out.push([`${counts}.`, next].filter(Boolean).join(' '))
  return out.join('\n')
}

function formatFinding(style: Style, before: string, finding: UpgradeFinding): string[] {
  const { paint } = style
  if (finding.mode === 'report') {
    return [
      `  ${paint('yellow', '!')} ${paint('dim', `${finding.id}:${finding.line}`)}  ${finding.message}`,
      `    ${paint('dim', finding.docsUrl)}`,
    ]
  }
  const out = [`  ${paint('dim', finding.id)}  ${finding.message}`]
  for (const hunk of hunks(before, finding.edits)) {
    const width = String(hunk.line + Math.max(hunk.before.length, hunk.after.length) - 1).length
    hunk.before.forEach((text, i) => out.push(paint('red', `    ${String(hunk.line + i).padStart(width)} - ${text}`)))
    hunk.after.forEach((text, i) => out.push(paint('green', `    ${String(hunk.line + i).padStart(width)} + ${text}`)))
  }
  return out
}
