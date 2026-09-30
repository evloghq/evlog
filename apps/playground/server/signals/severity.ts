import { defineSignal } from '@evlog/signals'

export const severity = defineSignal({
  name: 'severity',
  when: e => (e.status ?? 0) >= 500,
  ask: 'How urgent is this failure for the on-call engineer?',
  score: ['noise', 'watch', 'page'],
})
