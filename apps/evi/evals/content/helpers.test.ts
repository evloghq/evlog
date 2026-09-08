import type { EveEvalContext } from 'eve/evals'
import { expect, it } from 'vitest'
import { citedIds, reviewerReport, verdictOf } from './helpers'

function completed(output: string, subagentName = 'content_review'): EveEvalContext['events'][number] {
  return {
    type: 'subagent.completed',
    meta: { at: '2026-09-08T00:00:00Z', id: 'review-event' },
    data: { callId: 'review-call', subagentName, output },
  }
}

it('grades the actual reviewer output even when the parent only summarizes it', () => {
  const events: EveEvalContext['events'] = [completed('**Verdict**: blocked\n[T-15] Retired entry point.')]
  const report = reviewerReport(events)
  expect(verdictOf(report)).toBe('blocked')
  expect(citedIds(report)).toEqual(new Set(['T-15']))
})

it('selects the latest reviewer report and ignores other agents', () => {
  const events = [completed('**Verdict**: blocked'), completed('**Verdict**: pass'), completed('**Verdict**: blocked', 'content_rewrite')]
  expect(verdictOf(reviewerReport(events))).toBe('pass')
})

it('fails closed when no completed review exists, including background receipts', () => {
  const receipt = completed('**Verdict**: pass')
  if (receipt.type !== 'subagent.completed') throw new Error('Expected completion event')
  receipt.data.backgroundTask = { taskId: 'pending-review', status: 'working' }
  expect(reviewerReport([completed('**Verdict**: pass', 'content_rewrite'), receipt])).toBeNull()
  expect(verdictOf(reviewerReport([]))).toBeNull()
})
