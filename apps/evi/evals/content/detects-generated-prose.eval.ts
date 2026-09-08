import { defineEval } from 'eve/evals'
import { CONTENT_REVIEW_TIMEOUT_MS, GENERATED, citedIds, expectReviewedSnapshot, expectVerdictIn, reviewFixture } from './helpers'

// The fixture is saturated: a retired entry point, assistant framing, four
// unbacked comparisons, evlog's own concepts under other tools' names. A
// reviewer that returns anything short of `blocked` on it is not reading.
export default defineEval({
  description: 'The reviewer blocks the saturated fixture and names the phantom entry point.',
  tags: ['fast'],
  timeoutMs: CONTENT_REVIEW_TIMEOUT_MS,
  async test(t) {
    await t.send(reviewFixture(GENERATED))
    await expectReviewedSnapshot(t, GENERATED)
    t.succeeded()
    t.calledSubagent('content_review')
    t.notCalledTool('write_file')
    expectVerdictIn(t, ['blocked'])

    const ids = citedIds(t.reply)
    // T-15 is the only critical in the fixture: `evlog/shared` is not an entry
    // point, so nothing in that code block runs.
    t.eventsSatisfy('cites T-15 for the retired entry point', () => ids.has('T-15'))
    t.eventsSatisfy('cites at least three distinct findings', () => ids.size >= 3).soft()
  },
})
