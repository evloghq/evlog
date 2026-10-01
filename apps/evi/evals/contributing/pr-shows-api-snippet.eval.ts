import { defineEval } from 'eve/evals'
import { includes } from 'eve/evals/expect'

export default defineEval({
  // EVL-471: PR bodies for new APIs described the change in prose instead of
  // showing it. A usage snippet is the evidence; prose alone is not.
  description: 'Drafted the body for a new public API PR, the answer contains a fenced usage snippet, not prose alone.',
  tags: ['fast'],
  async test(t) {
    const turn = await t.send('You just added a new public helper `logger.timed(label, fn)` to packages/evlog on a branch, the checks are green, and you are about to open the pull request. Draft the PR body for me.')
    t.succeeded()
    t.loadedSkill('contributing')
    t.check(turn.message, includes(/```/))
    t.judge('contains a fenced code block showing a usage snippet of logger.timed, rather than only describing the API in prose').atLeast(0.5)
  },
})
