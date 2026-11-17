import type { SandboxSession } from 'eve/sandbox'
import type { SimplificationSweepResult } from './workflow'

/**
 * The sweep's structured result, written to disk by code the moment the tool
 * returns. A tool result lives only in the parent's context, and compaction
 * drops it long before the ledger is written, so the ledger is built from
 * these files, never transcribed from memory.
 */
export const SWEEP_RESULTS_DIR = '/workspace/sweep-results'

/** The tool's path-derived name, `agent/tools/simplification-sweep.ts`. */
export const SWEEP_TOOL_NAME = 'simplification-sweep'

export interface SweepRecord {
  dir: string
  files: { path: string, content: string }[]
}

/** `2026-11-16` from an ISO timestamp. */
function day(at: string) {
  return at.slice(0, 10)
}

function archiveHeading(result: SimplificationSweepResult, at: string) {
  return `Run ${day(at)}, revision ${result.revision.slice(0, 7)}`
}

/** The section the ledger's `archive/YYYY-MM.md` receives for this run, complete. */
export function renderArchiveSection(result: SimplificationSweepResult, at: string): string {
  const { counts } = result
  const lines = [
    `## ${archiveHeading(result, at)}`,
    '',
    `Status: ${result.status}. Revision \`${result.revision}\`.`,
    '',
    'Cohorts:',
    '',
    ...result.reviews.map(review => `- ${review.category}: ${review.scope}`),
    '',
    'Reviewer health:',
    '',
    ...result.reviewers.map(reviewer => `- \`${reviewer.agent}\`: ${reviewer.status}${reviewer.limitations.length > 0 ? `. ${reviewer.limitations.join(' ')}` : ''}`),
    '',
    `Counts: ${counts.proposed} proposed, ${counts.confirmed} confirmed, ${counts.rejected} rejected, ${counts.questions} questions, ${counts.proposals} proposals, ${counts.pullRequestCandidates} pull-request candidates in ${counts.pullRequestBatches} batches.`,
    '',
  ]
  if (result.verification.findings.length > 0) {
    lines.push('Findings:', '')
    for (const finding of result.verification.findings) {
      lines.push(`- ${finding.id} (${finding.kind}, \`${finding.path}:${finding.lines}\`): ${finding.verdict}, ${finding.delivery}. ${finding.problem} Verifier: ${finding.verification}`)
    }
    lines.push('')
  }
  lines.push(`Verifier summary: ${result.verification.summary}`, '')
  return lines.join('\n')
}

/** One line per rejected finding, in the shape `repo-health-sweep-rejected.jsonl` holds. */
export function renderRejectedLines(result: SimplificationSweepResult, at: string): string {
  const source = `archive/${day(at).slice(0, 7)}.md#${archiveHeading(result, at)}`
  return result.verification.findings
    .filter(finding => finding.verdict === 'rejected')
    .map(finding => `${JSON.stringify({
      area: finding.category,
      paths: [finding.path],
      claim: `${finding.id}: ${finding.problem}`,
      reason: finding.verification,
      date: day(at),
      revision: result.revision,
      source,
    })}\n`)
    .join('')
}

/** The files one sweep run writes, under a directory named for its date, revision and call. */
export function sweepRecord(result: SimplificationSweepResult, at: string, callId: string): SweepRecord {
  const dir = `${SWEEP_RESULTS_DIR}/${day(at)}-${result.revision.slice(0, 7)}-${callId}`
  return {
    dir,
    files: [
      { path: `${dir}/result.json`, content: `${JSON.stringify(result, null, 2)}\n` },
      { path: `${dir}/archive-section.md`, content: renderArchiveSection(result, at) },
      { path: `${dir}/rejected.jsonl`, content: renderRejectedLines(result, at) },
    ],
  }
}

/** Writes the record outside the checkout, so batch branches stay clean. */
export async function writeSweepRecord(sandbox: Pick<SandboxSession, 'run' | 'writeTextFile'>, record: SweepRecord) {
  await sandbox.run({ command: `mkdir -p '${record.dir}'` })
  for (const file of record.files) await sandbox.writeTextFile(file)
}
