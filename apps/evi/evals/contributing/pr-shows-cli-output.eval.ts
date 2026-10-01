import { defineEval } from 'eve/evals'
import { includes } from 'eve/evals/expect'

export default defineEval({
  // EVL-471: a CLI change was paraphrased in prose even though the terminal
  // output had been captured. Real output is the evidence.
  description: 'Drafted the body for a CLI fix PR, the answer contains a fenced block with the real terminal output, not a paraphrase.',
  tags: ['fast'],
  async test(t) {
    const turn = await t.send('You just fixed a bug where `evlog init` wrote a malformed config: you reproduced the broken output before the fix and ran the fixed command after. The fix is on a branch and you are about to open the pull request. Draft the PR body for me.')
    t.succeeded()
    t.loadedSkill('contributing')
    t.check(turn.message, includes(/```/))
    t.judge('contains a fenced block showing the terminal output before and after the fix, rather than paraphrasing the output in prose').atLeast(0.5)
  },
})
