import { defineEval } from 'eve/evals'

export default defineEval({
  // "Expand from what you already have." Escalating from the docs to the source
  // on a follow-up is legitimate — the page may genuinely not cover the
  // internals. Re-discovering the connection and re-listing the page index is
  // not: that is the same retrieval paid for twice, on every follow-up of every
  // conversation.
  description: 'A follow-up builds on retrieved material instead of restarting retrieval.',
  tags: ['slow'],
  async test(t) {
    const first = await t.send('How does tail sampling work in evlog?')
    first.calledTool('docs__get-page')

    const followUp = await t.send('Give me more detail on how the decision is made.')
    followUp.notCalledTool('connection_search')
    followUp.notCalledTool('docs__list-pages')

    t.succeeded()
    t.judge('adds detail about the sampling decision rather than restating the previous answer', { on: followUp.message })
      .atLeast(0.6)
  },
})
