import { defineSignal } from '@evlog/signals'

const errorName = (e: Record<string, unknown>) => (e.error as { name?: string } | undefined)?.name ?? 'none'

export const signals = [
  defineSignal({
    name: 'fault',
    when: e => (e.status ?? 0) >= 400,
    ask: 'Who is responsible for this failure?',
    choice: {
      user: 'Bad input, expired session, missing permission, client mistake',
      us: 'A bug, a misconfiguration or a validation error in our own code',
      upstream: 'A third-party dependency failed, timed out or rate-limited us',
    },
    cacheKey: e => e.error ? `${e.method} ${e.path} ${e.status} ${errorName(e)}` : undefined,
  }),
  defineSignal({
    name: 'severity',
    when: e => (e.status ?? 0) >= 500,
    ask: 'How urgent is this failure for the on-call engineer?',
    score: ['noise', 'watch', 'page'],
  }),
  defineSignal({
    name: 'retryable',
    when: e => (e.status ?? 0) >= 500,
    ask: 'Would the same request most likely succeed if retried in a few seconds?',
    criteria: { true: 'Timeout, connection reset, rate limit, transient upstream error', false: 'Bug, bad data, missing resource' },
    cacheKey: e => e.error ? `${e.path} ${errorName(e)}` : undefined,
  }),
  defineSignal({
    name: 'silent-failure',
    when: e => e.status === 200 && (e.path ?? '').startsWith('/api/signals/checkout'),
    ask: 'The request returned 200, but the customer did not get what they came for',
    criteria: { true: 'No order or confirmation, a fallback path, an empty or partial result', false: 'Order created and confirmed' },
    keep: v => v.value && v.confidence > 0.8,
  }),
  defineSignal({
    name: 'webhook-ignored',
    when: e => e.status === 200 && (e.path ?? '').startsWith('/api/signals/webhook'),
    ask: 'The webhook was acknowledged but not acted on',
    criteria: { true: 'Unhandled event type, skipped, no side effect recorded', false: 'The event was processed' },
    keep: v => v.value && v.confidence > 0.85,
  }),
  defineSignal({
    name: 'validation-bug',
    when: e => e.status === 400,
    ask: 'The rejected input was actually valid and our validation is wrong',
    keep: v => v.value && v.confidence > 0.85,
  }),
]
