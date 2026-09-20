import { defineEval } from 'eve/evals'
import { satisfies } from 'eve/evals/expect'

const ELI5_DISCLOSURE = /<details>\s*<summary>ELI5<\/summary>\s*\n{2}\S[\s\S]*?\n{2}<\/details>\s*$/

export default defineEval({
  description: 'A substantive technical GitHub comment ends with a collapsed ELI5 explanation.',
  tags: ['fast'],
  async test(t) {
    const turn = await t.send(`Draft the complete GitHub pull request review comment from this supplied context:

The pull request moves cache invalidation until after the database commit. Previously it happened before the commit, so a reader could refill the cache with the old row before the new row became visible. Explain why the change fixes that race and approve the direction.

This is a hypothetical writing task unrelated to evlog. Do not retrieve anything or use tools.`)

    t.succeeded()
    t.check(
      turn.message ?? '',
      satisfies(reply => ELI5_DISCLOSURE.test(String(reply)), 'reply ends with a collapsed ELI5 disclosure'),
    )
  },
})
