import { defineSignal } from '../src/define'

const isError = (status?: number) => (status ?? 0) >= 400
const isServerError = (status?: number) => (status ?? 0) >= 500
const errorName = (e: Record<string, unknown>) => (e.error as { name?: string } | undefined)?.name ?? 'none'

/** Every 4xx/5xx. Splits the error budget between the client, the code and the dependencies. */
export const fault = defineSignal({
  name: 'fault',
  when: e => isError(e.status),
  ask: 'Who is responsible for this failure?',
  choice: {
    client: 'Bad input, expired session, missing permission, client mistake',
    app: 'A bug, a misconfiguration or a validation error in our own code',
    upstream: 'A third-party dependency failed, timed out or rate-limited us',
  },
  cacheKey: e => e.error ? `${e.method} ${e.path} ${e.status} ${errorName(e)}` : undefined,
})

/** Every 5xx. Separates a blip from an outage without reading each one. */
export const severity = defineSignal({
  name: 'severity',
  when: e => isServerError(e.status),
  ask: 'How urgent is this failure for the on-call engineer?',
  score: ['noise', 'watch', 'page'],
})

/** Every 5xx. Tells a retry policy which failures are worth a second attempt. */
export const retryable = defineSignal({
  name: 'retryable',
  when: e => isServerError(e.status),
  ask: 'Would the same request most likely succeed if retried in a few seconds?',
  criteria: { true: 'Timeout, connection reset, rate limit, transient upstream error', false: 'Bug, bad data, missing resource' },
  cacheKey: e => e.error ? `${e.path} ${errorName(e)}` : undefined,
})

/** Successful checkouts. The 200 that sampling deletes and nobody notices. */
export const silentFailure = defineSignal({
  name: 'silent-failure',
  when: e => e.status === 200 && e.path === '/api/checkout',
  ask: 'The request returned 200, but the customer did not get what they came for',
  criteria: { true: 'No order or confirmation, a fallback path, an empty or partial result', false: 'Order created and confirmed' },
  keep: v => v.value && v.confidence > 0.8,
})

/** Acknowledged webhooks. A 200 to the provider means nothing if the event was dropped. */
export const webhookIgnored = defineSignal({
  name: 'webhook-ignored',
  when: e => e.status === 200 && (e.path ?? '').startsWith('/api/webhooks/'),
  ask: 'The webhook was acknowledged but not acted on',
  criteria: { true: 'Unhandled event type, skipped, no side effect recorded', false: 'The event was processed' },
  keep: v => v.value && v.confidence > 0.85,
})

/** Slow requests. Points at the component to blame before anyone opens a trace. */
export const slowCause = defineSignal({
  name: 'slow-cause',
  when: e => (e.durationMs ?? 0) > 2_000,
  ask: 'What dominated the duration of this request?',
  choice: {
    database: 'Query time, lock waits, many round trips',
    upstream: 'A third-party API or another service',
    compute: 'Serialization, rendering, large payloads, CPU work',
    unknown: 'Nothing in the event explains the time',
  },
})

/** Rejected requests. A validator that rejects valid input looks exactly like bad input. */
export const validationBug = defineSignal({
  name: 'validation-bug',
  when: e => e.status === 400,
  ask: 'The rejected input was actually valid and our validation is wrong',
  keep: v => v.value && v.confidence > 0.85,
})

/** Agent turns from evlog/eve. The judge that used to be sampled at a few percent. */
export const turnResolved = defineSignal({
  name: 'turn-resolved',
  when: e => e.method === 'EVE' && typeof (e.eve as { turnId?: string } | undefined)?.turnId === 'string',
  ask: 'The agent accomplished what the user asked for in this turn',
})

export const turnLooping = defineSignal({
  name: 'turn-looping',
  when: e => e.method === 'EVE' && typeof (e.eve as { turnId?: string } | undefined)?.turnId === 'string',
  ask: 'The agent repeated the same tool call without making progress',
  keep: v => v.value && v.confidence > 0.85,
})

export const turnOffScript = defineSignal({
  name: 'turn-off-script',
  when: e => e.method === 'EVE' && typeof (e.eve as { turnId?: string } | undefined)?.turnId === 'string',
  ask: 'The agent took an action the user did not ask for',
  keep: v => v.value && v.confidence > 0.85,
})

/** Audit events. Flags the handful of actions a reviewer should read. */
export const auditReview = defineSignal({
  name: 'audit-review',
  when: e => typeof e.audit === 'object' && e.audit !== null,
  ask: 'This action deserves a human review',
  criteria: {
    true: 'Privilege change, bulk deletion, export of personal data, action outside business hours by a non-admin',
    false: 'Routine self-service action',
  },
  keep: v => v.value && v.confidence > 0.8,
})

/** Background jobs forked from a request. Retries that succeed still hide a problem. */
export const jobFlaky = defineSignal({
  name: 'job-flaky',
  when: e => typeof e.operation === 'string' && ((e.retries as number | undefined) ?? 0) > 0,
  ask: 'The job only succeeded because it retried, and the underlying cause is still there',
})

export const catalog = [
  fault,
  severity,
  retryable,
  silentFailure,
  webhookIgnored,
  slowCause,
  validationBug,
  turnResolved,
  turnLooping,
  turnOffScript,
  auditReview,
  jobFlaky,
]
