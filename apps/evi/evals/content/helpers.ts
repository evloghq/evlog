import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EveEvalContext } from 'eve/evals'

/**
 * The two calibration fixtures, committed in the repository so the reviewer
 * reads a real file the way it reads a real page.
 *
 * Transfer local fixture text with the candidate commit so PR evals exercise
 * the candidate doctrine rather than the sandbox's initial main checkout.
 */
export const GENERATED = 'scripts/content-lint/fixtures/generated.md'
export const WRITTEN = 'scripts/content-lint/fixtures/written.md'

export function reviewFixture(path: string): string {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root }).trim()
  const text = readFileSync(resolve(root, path), 'utf8')
  const snapshot = { path, revision, sha256: createHash('sha256').update(text).digest('hex'), text }
  return `Review this complete page snapshot against the content doctrine using content_review and relay its report. Do not rewrite it. Have the reviewer call content_load and scan the snapshot text, then check facts even if the scan has no findings. Snapshot: ${JSON.stringify(snapshot)}`
}

/** Verdicts the reviewer is allowed to return, in order of severity. */
export const VERDICTS = ['pass', 'minor', 'significant', 'blocked'] as const

export type Verdict = typeof VERDICTS[number]

/** The `**Verdict**:` line from the relayed review, or null when nothing parseable came back. */
export function verdictOf(reply: string | null | undefined): Verdict | null {
  const match = /\*\*Verdict\*\*:\s*(pass|minor|significant|blocked)/i.exec(reply ?? '')
  return match ? match[1].toLowerCase() as Verdict : null
}

/**
 * Gate the verdict, and say what came back when it fails.
 *
 * A bare boolean assertion here reports "expected true, got false", which
 * costs a rerun at live-model prices to find out what the reviewer actually
 * said.
 */
export function expectVerdictIn(t: EveEvalContext, allowed: readonly Verdict[]) {
  const verdict = verdictOf(t.reply)
  return t.eventsSatisfy(
    verdict === null
      ? `expected a verdict in ${allowed.join(' | ')}, found no verdict line`
      : `verdict "${verdict}" is one of ${allowed.join(' | ')}`,
    () => verdict !== null && allowed.includes(verdict),
  )
}

/**
 * Gate that a subagent was never dispatched. `calledSubagent` has no negative
 * form, and delegations surface as `subagent.called` stream events.
 */
export function expectNoSubagent(t: EveEvalContext, name: string) {
  return t.eventsSatisfy(`never dispatched ${name}`, events =>
    !events.some((event) => {
      const candidate = event as { type?: string, data?: { name?: unknown } }
      return candidate.type === 'subagent.called' && candidate.data?.name === name
    }))
}

/**
 * Every finding id the relayed report cites. The review format puts them in
 * brackets at the head of each line.
 */
export function citedIds(reply: string | null | undefined): Set<string> {
  return new Set([...(reply ?? '').matchAll(/\[([A-Z]-\d{2})\]/g)].map(match => match[1]))
}
