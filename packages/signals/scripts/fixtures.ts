export interface Fixture {
  label: string
  method: string
  path: string
  status?: number
  error?: Error
  /** Simulated wall time, applied to the request clock. */
  durationMs?: number
  fields: Record<string, unknown>
}

const httpError = (name: string, message: string, statusCode: number) => Object.assign(new Error(message), { name, statusCode })

export const fixtures: Fixture[] = [
  {
    label: 'checkout-ok',
    method: 'POST',
    path: '/api/checkout',
    status: 200,
    fields: { user: { id: 'u_18', plan: 'pro' }, cart: { items: 3, total: 129.0 }, payment: { provider: 'stripe', status: 'succeeded' }, order: { id: 'ord_9f2', confirmationSent: true } },
  },
  {
    label: 'checkout-silent',
    method: 'POST',
    path: '/api/checkout',
    status: 200,
    fields: { user: { id: 'u_44', plan: 'free' }, cart: { items: 1, total: 49.0 }, payment: { provider: 'stripe', status: 'requires_action', fallback: true }, response: { message: 'Thanks! We will email you shortly.' } },
  },
  {
    label: 'users-ok',
    method: 'GET',
    path: '/api/users',
    status: 200,
    fields: { user: { id: 'u_2', role: 'admin' }, page: 1, results: 25 },
  },
  {
    label: 'checkout-upstream',
    method: 'POST',
    path: '/api/checkout',
    error: httpError('FetchError', 'request to https://api.stripe.com/v1/payment_intents failed, reason: read ECONNRESET', 502),
    fields: { user: { id: 'u_7' }, cart: { items: 2, total: 84.5 }, payment: { provider: 'stripe', attempt: 1 } },
  },
  {
    label: 'orders-bug',
    method: 'GET',
    path: '/api/orders/ord_31',
    error: httpError('TypeError', 'Cannot read properties of undefined (reading \'id\')', 500),
    fields: { user: { id: 'u_7' }, order: { id: 'ord_31', shipment: null } },
  },
  {
    label: 'login-expired',
    method: 'POST',
    path: '/api/login',
    error: httpError('SessionExpiredError', 'Refresh token expired 3 days ago', 401),
    fields: { auth: { method: 'refresh_token', issuedDaysAgo: 33 } },
  },
  {
    label: 'signup-bad-email',
    method: 'POST',
    path: '/api/signup',
    status: 400,
    fields: { validation: { field: 'email', value: 'notanemail', reason: 'must be a valid email address' } },
  },
  {
    label: 'signup-validator-bug',
    method: 'POST',
    path: '/api/signup',
    status: 400,
    fields: { validation: { field: 'email', value: 'hugo+test@example.com', reason: 'email must not contain "+"' } },
  },
  {
    label: 'search-slow',
    method: 'GET',
    path: '/api/search',
    status: 200,
    durationMs: 4_200,
    fields: { query: 'wide events', results: 12, db: { queries: 41, totalMs: 3_910 }, cache: { hit: false } },
  },
  {
    label: 'webhook-handled',
    method: 'POST',
    path: '/api/webhooks/stripe',
    status: 200,
    fields: { webhook: { provider: 'stripe', type: 'payment_intent.succeeded', handled: true }, order: { id: 'ord_9f2', status: 'paid' } },
  },
  {
    label: 'webhook-dropped',
    method: 'POST',
    path: '/api/webhooks/stripe',
    status: 200,
    fields: { webhook: { provider: 'stripe', type: 'charge.refunded', handled: false, reason: 'no handler registered for event type' } },
  },
  {
    label: 'agent-resolved',
    method: 'EVE',
    path: '/sessions/s_91/turns/t_4',
    status: 200,
    fields: {
      eve: { sessionId: 's_91', turnId: 't_4', phase: 'completed', sessionTurns: 4 },
      agent: { name: 'support' },
      message: { received: 'Cancel my subscription, I moved to the team plan.', response: 'Done. Your Pro subscription is cancelled and the unused days are credited to the team plan.' },
      tools: [{ name: 'getSubscription', ok: true }, { name: 'cancelSubscription', ok: true }, { name: 'applyCredit', ok: true }],
      ai: { model: 'openai/gpt-5.6-sol', inputTokens: 2_310, outputTokens: 180 },
    },
  },
  {
    label: 'agent-looping',
    method: 'EVE',
    path: '/sessions/s_92/turns/t_2',
    status: 200,
    fields: {
      eve: { sessionId: 's_92', turnId: 't_2', phase: 'completed', sessionTurns: 2 },
      agent: { name: 'support' },
      message: { received: 'Where is my invoice for August?', response: 'I could not find the invoice. Could you check your email?' },
      tools: [
        { name: 'searchDocs', args: { q: 'august invoice' }, results: 0 },
        { name: 'searchDocs', args: { q: 'august invoice' }, results: 0 },
        { name: 'searchDocs', args: { q: 'august invoice' }, results: 0 },
        { name: 'searchDocs', args: { q: 'invoice august' }, results: 0 },
      ],
      ai: { model: 'openai/gpt-5.6-luna', inputTokens: 6_020, outputTokens: 95 },
    },
  },
  {
    label: 'audit-export',
    method: 'POST',
    path: '/api/admin/export',
    status: 200,
    fields: {
      audit: { action: 'users.export', actor: { type: 'user', id: 'u_support_3', role: 'support' }, target: { type: 'dataset', id: 'all-users' }, outcome: 'success', at: '03:12 UTC' },
      export: { rows: 184_220, format: 'csv', includes: ['email', 'phone', 'address'] },
    },
  },
  {
    label: 'job-retried',
    method: 'JOB',
    path: '/jobs/export.csv',
    status: 200,
    fields: { operation: 'export.csv', retries: 2, attempts: [{ error: 'ETIMEDOUT s3.amazonaws.com' }, { error: 'ETIMEDOUT s3.amazonaws.com' }, { ok: true }], rows: 5_000 },
  },
]
