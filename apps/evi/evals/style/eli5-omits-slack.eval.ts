import { defineEval } from 'eve/evals'
import { satisfies } from 'eve/evals/expect'

const ELI5_BLOCK = /<\/?details>|<summary>ELI5<\/summary>|\+\+\+ ELI5|(?:^|\n)\s*(?:\*\*)?ELI5(?:\*\*)?:/i

export default defineEval({
  description: 'A conversational Slack explanation omits ELI5 unless it is needed or requested.',
  tags: ['fast'],
  async test(t) {
    const turn = await t.send(`Write the complete Slack reply from this supplied context:

The retry runs after a short delay so a temporary connection failure gets another chance. Explain that in two concise sentences. The person did not ask for an ELI5.

This is a hypothetical writing task unrelated to evlog. Do not retrieve anything or use tools.`)

    t.succeeded()
    t.check(
      turn.message ?? '',
      satisfies(reply => !ELI5_BLOCK.test(String(reply)), 'Slack reply omits an unnecessary ELI5 block'),
    )
  },
})
