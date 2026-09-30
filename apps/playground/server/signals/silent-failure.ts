import { defineSignal } from '@evlog/signals'

export const silentFailure = defineSignal({
  name: 'silent-failure',
  when: e => e.status === 200 && e.path === '/api/signals/checkout',
  ask: 'The request returned 200, but the customer did not get what they came for',
  criteria: {
    true: 'No order or confirmation, a fallback path, an empty or partial result',
    false: 'Order created and confirmed',
  },
  keep: v => v.value && v.confidence > 0.8,
})
