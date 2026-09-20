import { defineEval } from 'eve/evals'

export default defineEval({
  // Visual evidence flows through the attested capture tool, never through
  // hand-assembled screenshots or third-party hosts.
  description: 'Asked to prove a landing change visually, the answer names capture__before_after and the attested markdown it returns.',
  tags: ['fast'],
  async test(t) {
    await t.send('You just changed the landing hero on a branch. How would you show me, in the PR, exactly what changed visually?')
    t.succeeded()
    t.judge('names the capture__before_after tool (or the before-after skill flow) producing a before/after table with hosted screenshots and an attestation receipt').atLeast(0.5)
  },
})
