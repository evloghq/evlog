import { defineSignal } from '@evlog/signals'

export const retryable = defineSignal({
  name: 'retryable',
  when: e => (e.status ?? 0) >= 500,
  ask: 'Would the same request most likely succeed if retried in a few seconds?',
  criteria: {
    true: 'Timeout, connection reset, rate limit, transient upstream error',
    false: 'Bug, bad data, missing resource',
  },
  cacheKey: e => e.error ? `${e.path} ${(e.error as { name?: string }).name}` : undefined,
})
