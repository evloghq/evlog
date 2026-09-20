import { defineEval } from 'eve/evals'
import { satisfies } from 'eve/evals/expect'

const LINEAR_ELI5 = /\+\+\+ ELI5\s*\n\S[\s\S]*?\n\+\+\+\s*$/

export default defineEval({
  description: 'A substantive technical Linear response ends with a native collapsed ELI5 section.',
  tags: ['fast'],
  async test(t) {
    const turn = await t.send(`Draft the complete Linear Agent Session response from this supplied context:

The database migration now creates the replacement index before removing the old one. Explain why this prevents reads from losing index coverage during deployment.

This is a hypothetical writing task unrelated to evlog. Do not retrieve anything or use tools.`)

    t.succeeded()
    t.check(
      turn.message ?? '',
      satisfies(reply => LINEAR_ELI5.test(String(reply)), 'reply ends with a Linear ELI5 section'),
    )
  },
})
