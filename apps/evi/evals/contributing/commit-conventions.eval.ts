import { defineEval } from 'eve/evals'
import { includes } from 'eve/evals/expect'

export default defineEval({
  // Conventional Commits with a lowercase subject is machine-checkable, so this
  // needs no judge. CI lints PR titles against the same rule, which makes a
  // capitalized subject here a wasted review cycle downstream.
  description: 'A drafted commit subject follows Conventional Commits and stays lowercase.',
  tags: ['fast'],
  async test(t) {
    const turn = await t.send('Draft the commit subject for a fix to the Axiom drain adapter that stops it dropping the last batch on shutdown.')
    t.succeeded()
    t.loadedSkill('contributing')
    t.check(turn.message, includes(/\b(feat|fix|docs|refactor|test|perf|chore)(\([a-z][a-z-]*\))?: [a-z]/))
  },
})
