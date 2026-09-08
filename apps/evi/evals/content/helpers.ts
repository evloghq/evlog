import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EveEvalContext } from 'eve/evals'
import { executeExample } from './example'

/**
 * The two calibration fixtures, committed in the repository so the reviewer
 * reads a real file the way it reads a real page.
 *
 * Pin the candidate commit so PR evals exercise its fixtures and doctrine
 * rather than the sandbox's initial main checkout.
 */
export const GENERATED = 'scripts/content-lint/fixtures/generated.md'
export const WRITTEN = 'scripts/content-lint/fixtures/written.md'

// A cold Docker workspace installs the monorepo and browser before the review starts.
export const CONTENT_REVIEW_TIMEOUT_MS = 8 * 60 * 1000

function fixtureSnapshot(path: string) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root }).trim()
  const text = readFileSync(resolve(root, path), 'utf8')
  return { root, text, snapshot: { path, revision, sha256: createHash('sha256').update(text).digest('hex') } }
}

export function reviewFixture(path: string): string {
  const { root, text, snapshot } = fixtureSnapshot(path)
  const { revision } = snapshot
  let evidence = ''
  if (path === WRITTEN) {
    const sample = /```js\n([\s\S]*?)\n```/.exec(text)?.[1]
    if (sample === undefined) throw new Error('The positive fixture must contain its executable example.')
    executeExample(sample, root)
    evidence = ` Execution evidence from the eval runner: the exact JavaScript fence in this snapshot was run with node --input-type=module in packages/evlog at ${revision}; exit code 0, including its event-count and action assertions. Pass this evidence to the reviewer.`
  }
  return `Review ${path} at candidate commit ${revision} against the content doctrine. In the parent sandbox, fetch that commit from origin and check it out detached in /workspace/repo before delegating to content_review. Pass this expected snapshot unchanged; the reviewer must call content_load and verify facts even if the prose scanner has no findings. Relay the report without rewriting files. Snapshot: ${JSON.stringify(snapshot)}${evidence}`
}

export async function expectReviewedSnapshot(t: EveEvalContext, path: string): Promise<void> {
  // Parent streams contain delegation events, not the child's tool calls.
  const children = t.events.flatMap(event => event.type === 'subagent.called' && event.data.name === 'content_review' ? [event.data.childSessionId] : [])
  for (const child of new Set(children)) await t.target.attachSession(child)
  t.calledTool('content_load', { input: fixtureSnapshot(path).snapshot })
}

/** Verdicts the reviewer is allowed to return, in order of severity. */
export const VERDICTS = ['pass', 'minor', 'significant', 'blocked'] as const

export type Verdict = typeof VERDICTS[number]

export function reviewerReport(events: EveEvalContext['events']): string | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'subagent.completed' && event.data.subagentName === 'content_review' && !event.data.backgroundTask) {
      return event.data.output
    }
  }
  return null
}

/** The `**Verdict**:` line from the review, or null when nothing parseable came back. */
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
  const verdict = verdictOf(reviewerReport(t.events))
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
 * Every finding id the report cites. The review format puts them in
 * brackets at the head of each line.
 */
export function citedIds(reply: string | null | undefined): Set<string> {
  return new Set([...(reply ?? '').matchAll(/\[([A-Z]-\d{2})\]/g)].map(match => match[1]))
}
