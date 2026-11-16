import { defineEval } from 'eve/evals'
import { includes, satisfies } from 'eve/evals/expect'

/**
 * Prose words a reviewer reads before the proof: the draft is unwrapped from
 * an outer markdown fence when the reply quotes it whole, then inner fenced
 * blocks and the ELI5 disclosure are left out.
 */
function proseWords(reply: string) {
  // Greedy: a draft quoted in a three-backtick fence closes on its last fence line.
  const wrapped = reply.match(/(`{3,})(?:md|markdown)\n([\s\S]*)\n\1/)
  const body = wrapped ? wrapped[2] : reply
  const prose = body
    .replace(/(`{3,})[\s\S]*?\1/g, '')
    .replace(/<details>[\s\S]*?<\/details>/g, '')
  return prose.split(/\s+/).filter(Boolean).length
}

export default defineEval({
  // #1061 (+39/-4) shipped eight sections and ~600 words; the failing
  // assertions and the one-line envelope diff were buried among them.
  description: 'A drafted body for a small fix keeps the prose short and shows only the evidence it was given.',
  tags: ['fast'],
  async test(t) {
    const turn = await t.send(`You fixed the Sentry drain so each log carries the reserved \`user.id\` attribute, as the official SDK does. Diff: +12/-1 in packages/evlog/src/adapters/sentry.ts, plus one test.

Before the fix, the new test failed with:
AssertionError: expected undefined to deeply equal { value: 'u_1', type: 'string' }
After: sentry.test.ts 49 passed (49). Lint, typecheck and the full suite pass. A patch changeset is included.

Draft the PR body for me. Do not retrieve anything or use tools.`)

    t.succeeded()
    t.check(turn.reply, includes(/```/))
    t.check(
      turn.reply ?? '',
      satisfies(reply => proseWords(String(reply)) <= 150, 'prose outside code blocks and ELI5 is 150 words or fewer'),
    )
    t.judge('The drafted PR body shows only evidence supplied in the prompt: it contains no invented diff, payload, or output, and no placeholder or TODO asking for evidence to be filled in later.').atLeast(0.5)
  },
})
