import { defineEval } from 'eve/evals'
import { GITHUB_ISSUE_SEARCH_TOOLS, calledAnyTool } from '../helpers'

export default defineEval({
  // "Check GitHub before answering a bug report" costs nothing when followed and
  // wastes a maintainer's afternoon when it is not: a fresh explanation of a bug
  // that already has a thread.
  //
  // No `succeeded()` gate. A vague report legitimately ends parked on one
  // clarifying question, which is the documented behavior, so the run-complete
  // assertion would fail a correct answer.
  description: 'A bug report triggers an issue search before an explanation.',
  tags: ['fast', 'needs-connect'],
  async test(t) {
    await t.send('evlog redaction is broken for me — my authorization header still shows up in the drained event.')
    t.noFailedCalls()
    calledAnyTool(t, 'searched existing issues', GITHUB_ISSUE_SEARCH_TOOLS)
    // Soft on purpose: this is the "escalate, do not fan out" budget, and it is
    // the one number here that tracks cost rather than correctness. Measured at
    // 46 calls on the first run; the bar is set where the answer was already
    // fully supported, so a miss is a signal to read the trace, not a red build.
    t.maxToolCalls(20).soft()
  },
})
