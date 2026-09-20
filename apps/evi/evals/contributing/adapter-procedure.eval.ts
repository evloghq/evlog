import { defineEval } from 'eve/evals'

export default defineEval({
  description: 'A contribution question loads the contributing skill instead of being answered from memory.',
  tags: ['slow'],
  async test(t) {
    await t.send('I want to add a new drain adapter to evlog. What do I need to do?')
    t.succeeded()
    t.loadedSkill('contributing')
    t.judge('mentions that a changeset is required and points at the repository\'s create-adapter procedure')
      .atLeast(0.6)
  },
})
