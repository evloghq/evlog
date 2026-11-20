import { defineEval } from 'eve/evals'

// Run on its own with logs.source vercel, once without an OIDC token and once with Connect refusing it.
export default defineEval({
  tags: ['vercel'],
  async test(t) {
    await t.send('logs errors')
  },
})
