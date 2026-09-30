import { defineSignal } from '@evlog/signals'

export const fault = defineSignal({
  name: 'fault',
  when: e => (e.status ?? 0) >= 400,
  ask: 'Who is responsible for this failure?',
  choice: {
    user: 'Bad input, expired session, missing permission, client mistake',
    us: 'A bug, a misconfiguration or a validation error in our own code',
    upstream: 'A third-party dependency failed, timed out or rate-limited us',
  },
  cacheKey: e => e.error ? `${e.method} ${e.path} ${e.status} ${(e.error as { name?: string }).name}` : undefined,
})
