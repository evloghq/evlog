export interface ScenarioRequest {
  method: string
  path: string
  body?: unknown
}

export interface ScenarioStep {
  id: string
  /** What the reader added to get here, as the rail lists it. */
  label: string
  /** The reader's code at this step, relative to this directory. */
  file: string
  /** Other files of the reader's app at this step that a page may show, such as an error catalog. */
  also?: string[]
  /** Replaces the scenario's config for this step. */
  config?: string
  request?: ScenarioRequest
  /** The file calls `initLogger()` in its own first lines, as a script or a Lambda handler does. */
  starts?: boolean
  /** Pins `Math.random()`, which decides head sampling, so the same events are kept on every run. */
  draw?: number
  /** evlog emits nothing at this step. Shown where the event would be. */
  dropped?: string
}

export interface Scenario {
  /** The entry point the event goes through: an integration, or `evlog` for a script or a handler. */
  via: 'evlog/hono' | 'evlog'
  /** The reader's `evlog.config.ts`. */
  config: string
  /** Sent to the Hono app each step file exports. */
  request?: ScenarioRequest
  /** Passed to the `handler` each step file exports. */
  invoke?: unknown
  steps: ScenarioStep[]
}

const checkout: ScenarioRequest = { method: 'POST', path: '/api/checkout', body: { cartId: 'cart_42' } }
const refund: ScenarioRequest = { method: 'POST', path: '/api/invoices/refund', body: { invoiceId: 'inv_1842', userId: 'usr_123' } }
const signup: ScenarioRequest = { method: 'POST', path: '/api/users', body: { email: 'alice@example.com' } }

export const scenarios: Record<string, Scenario> = {
  checkout: {
    via: 'evlog/hono',
    config: 'evlog.config.ts',
    request: checkout,
    steps: [
      { id: 'request', label: 'The integration alone', file: 'checkout/request.ts' },
      { id: 'context', label: 'log.set()', file: 'checkout/context.ts' },
      { id: 'error', label: 'createError()', file: 'checkout/error.ts' },
    ],
  },
  declined: {
    via: 'evlog/hono',
    config: 'evlog.config.ts',
    request: checkout,
    steps: [
      { id: 'context', label: 'Before the throw', file: 'checkout/context.ts' },
      { id: 'error', label: 'createError()', file: 'errors/declined.ts' },
    ],
  },
  catalog: {
    via: 'evlog/hono',
    config: 'evlog.config.ts',
    request: { method: 'GET', path: '/api/users/usr_404' },
    steps: [
      { id: 'inline', label: 'createError()', file: 'catalogs/inline.ts' },
      { id: 'catalog', label: 'errors.USER_NOT_FOUND()', file: 'catalogs/route.ts', also: ['catalogs/errors.ts'] },
    ],
  },
  hono: {
    via: 'evlog/hono',
    config: 'hono/evlog.config.ts',
    request: { method: 'GET', path: '/users/usr_123' },
    steps: [
      { id: 'middleware', label: 'app.use(evlog())', file: 'hono/middleware.ts' },
      { id: 'handler', label: 'c.get(\'log\')', file: 'hono/handler.ts' },
      { id: 'error', label: 'app.onError()', file: 'hono/error.ts', request: { method: 'GET', path: '/users/usr_404' } },
    ],
  },
  sync: {
    via: 'evlog',
    config: 'evlog.config.ts',
    steps: [
      { id: 'logger', label: 'createLogger()', file: 'sync/logger.ts' },
      { id: 'context', label: 'log.set()', file: 'sync/context.ts' },
    ],
  },
  standalone: {
    via: 'evlog',
    config: 'evlog.config.ts',
    steps: [{ id: 'run', label: 'log.emit()', file: 'standalone/sync.ts', starts: true }],
  },
  lambda: {
    via: 'evlog',
    config: 'evlog.config.ts',
    invoke: {
      Records: [{ messageId: 'msg_7f3a', eventSourceARN: 'arn:aws:sqs:eu-west-1:123456789012:emails', body: '{"to":"usr_123"}' }],
    },
    steps: [{ id: 'record', label: 'log.emit()', file: 'lambda/handler.ts', starts: true }],
  },
  refund: {
    via: 'evlog/hono',
    config: 'evlog.config.ts',
    request: refund,
    steps: [
      { id: 'allowed', label: 'log.audit()', file: 'audit/refund.ts' },
      { id: 'denied', label: 'log.audit.deny()', file: 'audit/refund.ts', request: { ...refund, body: { invoiceId: 'inv_1842', userId: 'usr_456' } } },
    ],
  },
  sampling: {
    via: 'evlog/hono',
    config: 'sampling/evlog.config.ts',
    request: signup,
    steps: [
      { id: 'unsampled', label: 'No sampling', file: 'sampling/app.ts', config: 'evlog.config.ts' },
      {
        id: 'rates',
        label: 'rates: { info: 10 }',
        file: 'sampling/app.ts',
        draw: 0.5,
        dropped: 'Nothing printed. This request is one of the nine in ten that head sampling drops.',
      },
      { id: 'keep', label: 'keep: [{ path }]', file: 'sampling/app.ts', draw: 0.5, request: { method: 'POST', path: '/api/payments/charge', body: { amount: 9999 } } },
    ],
  },
  redaction: {
    via: 'evlog/hono',
    config: 'evlog.config.ts',
    request: {
      method: 'POST',
      path: '/api/users',
      body: { email: 'alice@example.com', phone: '+33 6 12 34 56 78', cardNumber: '4111111111111111', sessionToken: 'sess_8f2c1d9e4b7a' },
    },
    steps: [
      { id: 'development', label: 'In development', file: 'redaction/app.ts' },
      { id: 'on', label: 'redact: true', file: 'redaction/app.ts', config: 'redaction/on.config.ts' },
      { id: 'narrowed', label: 'redact: { builtins }', file: 'redaction/app.ts', config: 'redaction/narrowed.config.ts' },
    ],
  },
}
