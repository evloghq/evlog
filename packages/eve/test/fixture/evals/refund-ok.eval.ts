import { defineEval } from 'eve/evals'

export default defineEval({
  async test(t) {
    await t.send('refund 9001')
    t.succeeded()
  },
})
