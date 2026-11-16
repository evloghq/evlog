import { defineEval } from 'eve/evals'

export default defineEval({
  // "Escalate, do not fan out." This is the only eval that guards cost directly:
  // one docs question that opens the page index, reads a page, and stops. A
  // regression here shows up on the bill before it shows up in an answer, and
  // the ceiling is deliberately loose enough to allow one retry phrasing.
  description: 'A single documented question stays within a small tool budget.',
  tags: ['fast'],
  async test(t) {
    await t.send('What does the redact option do in evlog?')
    t.succeeded()
    t.noFailedCalls()
    t.maxToolCalls(6)
    t.notCalledTool('github__searchCode')
  },
})
