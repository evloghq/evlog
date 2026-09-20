import { defineEval } from 'eve/evals'
import { satisfies } from 'eve/evals/expect'

// "Do not narrate your process. No 'let me check', no 'I'll search the docs'."
// The opening clause is where it leaks, so the check is anchored to the start
// of the reply rather than searching the whole body — "let me know if" further
// down is fine.
const NARRATION = /^\s*(?:ok(?:ay)?[,.]?\s*)?(?:let me|i'?ll|i am going to|i'm going to|first,? (?:let me|i)|checking|searching|looking)\b/i

export default defineEval({
  description: 'The reply opens with the answer, not with a statement of intent.',
  tags: ['fast'],
  async test(t) {
    const turn = await t.send('Does evlog support sampling?')
    t.succeeded()
    t.check(
      turn.message ?? '',
      satisfies(reply => !NARRATION.test(String(reply)), 'reply does not open by narrating retrieval'),
    )
  },
})
