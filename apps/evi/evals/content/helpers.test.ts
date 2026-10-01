import { expect, it } from 'vitest'
import { citedIds, reviewerReport, verdictOf, type EvalEvents } from './helpers'

function settled(data: { output: string } | { error: { message: string } }, name = 'content_review'): EvalEvents[number] {
  return {
    type: 'task.settled',
    meta: { at: '2026-09-08T00:00:00Z', id: 'review-event' },
    data: {
      callId: 'review-call',
      kind: 'agent',
      name,
      taskId: 'review-task',
      turnId: 'turn_0',
      ...('output' in data ? { status: 'completed', output: data.output } : { status: 'failed', error: data.error }),
    },
  }
}

it('grades the actual reviewer output even when the parent only summarizes it', () => {
  const events: EvalEvents = [settled({ output: '**Verdict**: blocked\n[T-15] Retired entry point.' })]
  const report = reviewerReport(events)
  expect(verdictOf(report)).toBe('blocked')
  expect(citedIds(report)).toEqual(new Set(['T-15']))
})

it('selects the latest reviewer report and ignores other agents', () => {
  const events = [
    settled({ output: '**Verdict**: blocked' }),
    settled({ output: '**Verdict**: pass' }),
    settled({ output: '**Verdict**: blocked' }, 'content_rewrite'),
  ]
  expect(verdictOf(reviewerReport(events))).toBe('pass')
})

it('fails closed when no completed review exists', () => {
  const events = [settled({ output: '**Verdict**: pass' }, 'content_rewrite'), settled({ error: { message: 'review failed' } })]
  expect(reviewerReport(events)).toBeNull()
  expect(verdictOf(reviewerReport([]))).toBeNull()
})
