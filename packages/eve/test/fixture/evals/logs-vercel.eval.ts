import { defineEval } from 'eve/evals'

// Run on its own against Vercel: without a connector, without an OIDC token, and with Connect refusing it.
export default defineEval({
  tags: ['vercel'],
  async test(t) {
    await t.send('logs errors')
  },
})
