import { defineEval } from 'eve/evals'
import { WRITTEN, expectNoSubagent, expectVerdictIn, reviewFixture } from './helpers'

// The mirror of the detection eval, and the one that matters more. A reviewer
// that finds fault everywhere produces a rewriter that edits everything, and a
// corpus that drifts one confident rewrite at a time. The fixture carries the
// lawful twins on purpose: a three-item list, an even reference register, a
// closer that lands a number.
export default defineEval({
  description: 'The reviewer passes a page that reads right, and does not rewrite it.',
  tags: ['fast'],
  timeoutMs: 4 * 60 * 1000,
  async test(t) {
    await t.send(reviewFixture(WRITTEN))
    t.succeeded()
    t.calledSubagent('content_review')
    t.notCalledTool('write_file')
    expectNoSubagent(t, 'content_rewrite')
    expectVerdictIn(t, ['pass', 'minor'])
  },
})
