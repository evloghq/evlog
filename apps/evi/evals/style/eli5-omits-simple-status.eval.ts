import { defineEval } from 'eve/evals'
import { satisfies } from 'eve/evals/expect'

export default defineEval({
  description: 'A simple GitHub status comment does not add an ELI5 disclosure.',
  tags: ['fast'],
  async test(t) {
    const turn = await t.send(`Write the complete GitHub pull request comment for this situation: all requested changes were addressed and the checks pass. Keep it to one short status sentence.

This is a hypothetical writing task unrelated to evlog. Do not retrieve anything or use tools.`)

    t.succeeded()
    t.check(
      turn.message ?? '',
      satisfies(reply => !/<\/?details>|<summary>ELI5<\/summary>/i.test(String(reply)), 'reply omits an ELI5 disclosure'),
    )
  },
})
