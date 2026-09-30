import { defineSignal } from '@evlog/signals'

export const webhookIgnored = defineSignal({
  name: 'webhook-ignored',
  when: e => e.status === 200 && (e.path ?? '').startsWith('/api/signals/webhook'),
  ask: 'The webhook was acknowledged but not acted on',
  criteria: {
    true: 'Unhandled event type, skipped, no side effect recorded',
    false: 'The event was processed',
  },
  keep: v => v.value && v.confidence > 0.85,
})
