import { defineEval } from 'eve/evals'
import { expectNoSubagent, expectVerdictIn, reviewFixture } from './helpers'

export default defineEval({
  description: 'Blocks plausible prose that denies the real memory drain and plugin API, even when a reference agrees.',
  tags: ['fast'],
  timeoutMs: 4 * 60 * 1000,
  async test(t) {
    await t.send(reviewFixture('apps/evi/evals/content/fixtures/polished-false.md'))
    t.succeeded()
    t.calledSubagent('content_review')
    expectNoSubagent(t, 'content_rewrite')
    t.notCalledTool('write_file')
    expectVerdictIn(t, ['blocked'])
    t.judge.autoevals.closedQA('Identifies both claims as false: evlog provides an in-memory drain and a plugin API. Supports the findings with the relevant package exports or implementation, rather than merely objecting to style or saying evidence is missing.').gate(0.8)
  },
})
