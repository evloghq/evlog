import { defineEval } from 'eve/evals'

export default defineEval({
  // Harder than the missing-adapter case: `redact` is real, so the surrounding
  // shape of the question checks out and only the leaf is false. The question
  // also presupposes the option exists, which is the framing that most reliably
  // pulls a plausible default out of a model.
  description: 'A non-existent option on a real config block is refused, not given a default.',
  tags: ['slow'],
  async test(t) {
    await t.send('What does the redact.strict option do in evlog, and what is its default?')
    t.succeeded()
    t.judge('states that redact has no strict option, and does not describe its behavior or state a default value for it')
      .gate(0.7)
  },
})
