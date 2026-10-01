import { defineEval } from 'eve/evals'

export default defineEval({
  // EVL-471: docs edits were treated as not visual, so eight apps/docs PRs
  // shipped without a capture. A prose edit to a rendered page still captures.
  description: 'Asked what goes in the PR body for a docs edit, the answer names a before-after capture as part of it.',
  tags: ['fast'],
  async test(t) {
    const turn = await t.send('You just rewrote the sampling section of a docs page in apps/docs on a branch. What goes in the PR body to show that change?')
    t.succeeded()
    t.loadedSkill('before-after')
    t.judge('names a before-after capture (the capture__before_after tool or the before-after skill flow) as part of the PR body').atLeast(0.5)
  },
})
