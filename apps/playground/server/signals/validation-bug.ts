import { defineSignal } from '@evlog/signals'

export const validationBug = defineSignal({
  name: 'validation-bug',
  when: e => e.status === 400,
  ask: 'The rejected input was actually valid and our validation is wrong',
  keep: v => v.value && v.confidence > 0.85,
})
