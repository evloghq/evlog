import { defineEval } from 'eve/evals'

// The files are development's, so a read that expects production is refused.
export default defineEval({
  async test(t) {
    await t.send('logs errors expect production')
  },
})
