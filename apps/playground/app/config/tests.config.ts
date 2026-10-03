import { createError, parseError } from 'evlog'
import { createHttpLogDrain } from 'evlog/http'
import { authClient } from '~/lib/auth-client'

export interface TestConfig {
  id: string
  label: string
  endpoint?: string
  method?: 'GET' | 'POST'
  onClick?: () => void | Promise<void>
  color?: string
  variant?: string
  description?: string
  badge?: {
    label: string
    color: string
  }
  showResult?: boolean
  toastOnSuccess?: {
    title: string
    description: string
  }
  toastOnError?: {
    title: string
    description: string
  }
}

export interface TestSection {
  id: string
  label: string
  icon?: string
  title: string
  description: string
  tests: TestConfig[]
  layout?: 'buttons' | 'cards' | 'grid'
  gridCols?: number
}

function makeDrainEvent(action: string, extra?: Record<string, unknown>) {
  return {
    event: {
      timestamp: new Date().toISOString(),
      level: 'info' as const,
      service: 'browser',
      environment: 'development',
      action,
      ...extra,
    },
  }
}

export const testConfig = {
  sections: [
    {
      id: 'min-level',
      label: 'Min level',
      icon: 'i-lucide-sliders-horizontal',
      title: 'Minimum log level (client)',
      description:
        'Deterministic filter for the client `log` API: choose a minimum severity, trigger each level, and confirm blocked lines never reach the console or ingest. Use `setMinLevel` at runtime without reload.',
      tests: [],
    } as TestSection,
    {
      id: 'client-logging',
      label: 'Client Logging',
      icon: 'i-lucide-laptop',
      title: 'Client-side Logging',
      description: 'These logs appear in the browser console with pretty formatting.',
      layout: 'cards',
      tests: [
        {
          id: 'client-info',
          label: 'log.info()',
          description: 'Log informational messages to the browser console with structured data',
          onClick: () => log.info({ action: 'test_client', timestamp: Date.now() }),
          badge: {
            label: 'Info',
            color: 'blue',
          },
        },
        {
          id: 'client-warn',
          label: 'log.warn()',
          description: 'Log warning messages for non-critical issues',
          color: 'warning',
          onClick: () => log.warn('validation', 'Form field is empty'),
          badge: {
            label: 'Warning',
            color: 'warning',
          },
        },
        {
          id: 'client-error',
          label: 'log.error()',
          description: 'Log error messages for caught exceptions',
          color: 'error',
          onClick: () => log.error('validation', 'Form field is empty'),
          badge: {
            label: 'Error',
            color: 'error',
          },
        },
        {
          id: 'client-create-error',
          label: 'createError()',
          description: 'Create structured errors with context (message, why, fix, link)',
          color: 'error',
          onClick: () => {
            const error = createError({
              message: 'Test structured error',
              status: 400,
              why: 'This is a demonstration of the EvlogError format',
              fix: 'No fix needed - this is just a demo',
              link: 'https://github.com/evloghq/evlog',
            })
            console.error(String(error))
          },
          badge: {
            label: 'Structured',
            color: 'red',
          },
        },
      ],
    } as TestSection,
    {
      id: 'identity',
      label: 'Identity',
      icon: 'i-lucide-user',
      title: 'Client Identity',
      description: 'Attach user identity to all client logs via setIdentity(). Identity fields are included in every log and transported to the server. PostHog auto-maps userId → distinct_id.',
      layout: 'cards',
      tests: [
        {
          id: 'identity-set',
          label: 'setIdentity()',
          description: 'Sets userId and orgId on all future client logs. Open the console and check the transport payload.',
          color: 'primary',
          onClick: () => {
            setIdentity({ userId: 'usr_123', orgId: 'org_456' })
            log.info({ action: 'identity_set', message: 'Identity set to usr_123 / org_456' })
          },
          badge: {
            label: 'setIdentity',
            color: 'blue',
          },
        },
        {
          id: 'identity-log',
          label: 'log.info() with identity',
          description: 'Emits a log — identity fields (userId, orgId) are automatically included.',
          onClick: () => {
            log.info({ action: 'checkout', item: 'pro_plan' })
          },
          badge: {
            label: 'Auto-enriched',
            color: 'green',
          },
        },
        {
          id: 'identity-override',
          label: 'Override userId',
          description: 'Per-event fields take priority over identity. This log overrides userId.',
          color: 'warning',
          onClick: () => {
            log.info({ action: 'impersonate', userId: 'usr_admin_override' })
          },
          badge: {
            label: 'Event > Identity',
            color: 'warning',
          },
        },
        {
          id: 'identity-clear',
          label: 'clearIdentity()',
          description: 'Clears identity context. Future logs will no longer include userId/orgId.',
          color: 'error',
          onClick: () => {
            clearIdentity()
            log.info({ action: 'identity_cleared', message: 'Identity context cleared' })
          },
          badge: {
            label: 'clearIdentity',
            color: 'red',
          },
        },
      ],
    } as TestSection,
    {
      id: 'wide-events',
      label: 'Wide Events',
      icon: 'i-lucide-server',
      title: 'Server-side Wide Events',
      description: 'These calls trigger API endpoints that use useLogger(event) to build wide events. Check the terminal for structured output.',
      layout: 'cards',
      tests: [
        {
          id: 'api-success',
          label: 'Test Success',
          description: 'Successful API request with wide event logging',
          endpoint: '/api/test/success',
          method: 'GET',
          color: 'success',
          badge: {
            label: 'GET /api/test/success',
            color: 'green',
          },
        },
        {
          id: 'api-error',
          label: 'Test Error',
          description: 'API error response with automatic error logging',
          endpoint: '/api/test/error',
          method: 'GET',
          color: 'error',
          badge: {
            label: 'GET /api/test/error',
            color: 'red',
          },
        },
        {
          id: 'api-wide-event',
          label: 'Test Wide Event',
          description: 'Complete wide event with custom fields and metadata',
          endpoint: '/api/test/wide-event',
          method: 'GET',
          color: 'primary',
          badge: {
            label: 'Wide Event',
            color: 'blue',
          },
        },
      ],
    } as TestSection,
    {
      id: 'audit',
      label: 'Audit Logs',
      icon: 'i-lucide-shield-check',
      title: 'Audit Logs',
      description: 'First-class audit trails composed on the same wide-event pipeline. Every event is force-kept (never sampled), enriched with request context (`auditEnricher`), and routed to a tamper-evident sink (`auditOnly(signed(fsDrain))` writing hash-chained NDJSON to .audit/). Trigger each scenario and inspect both the terminal wide event and the .audit/ directory.',
      layout: 'cards',
      tests: [
        {
          id: 'audit-refund-success',
          label: 'log.audit() — success',
          description: 'Manual log.audit() inside a handler. Records action=invoice.refund with auditDiff(before, after) and outcome=success.',
          endpoint: '/api/audit/refund',
          method: 'POST',
          color: 'success',
          showResult: true,
          badge: {
            label: 'POST /api/audit/refund',
            color: 'green',
          },
          toastOnSuccess: {
            title: 'Audit recorded',
            description: 'Check the terminal wide event and .audit/ for the hash-chained entry',
          },
        },
        {
          id: 'audit-refund-deny',
          label: 'log.audit.deny()',
          description: 'Records a denied authorisation check (outcome=denied) and throws a 403 structured error. Auditors care most about denials.',
          endpoint: '/api/audit/deny',
          method: 'POST',
          color: 'error',
          badge: {
            label: 'POST /api/audit/deny',
            color: 'red',
          },
          toastOnError: {
            title: 'Denial audited',
            description: 'The 403 is expected — the audit event with outcome=denied was recorded before the throw',
          },
        },
        {
          id: 'audit-with-audit-success',
          label: 'withAudit() — success',
          description: 'Wraps an action with withAudit(). Outcome resolves automatically: returned value → success.',
          color: 'success',
          onClick: async () => {
            await $fetch('/api/audit/with-audit', {
              method: 'POST',
              body: { scenario: 'success' },
            })
          },
          badge: {
            label: 'outcome: success',
            color: 'green',
          },
          toastOnSuccess: {
            title: 'withAudit() success',
            description: 'Action returned cleanly → outcome=success was recorded automatically',
          },
        },
        {
          id: 'audit-with-audit-failure',
          label: 'withAudit() — failure',
          description: 'Same wrapper, but the action throws a non-403 error. Outcome resolves to failure and the error is re-thrown.',
          color: 'warning',
          onClick: async () => {
            await $fetch('/api/audit/with-audit', {
              method: 'POST',
              body: { scenario: 'failure' },
            })
          },
          badge: {
            label: 'outcome: failure',
            color: 'warning',
          },
          toastOnSuccess: {
            title: 'withAudit() failure',
            description: 'Action threw → outcome=failure recorded, error.message captured as reason',
          },
        },
        {
          id: 'audit-with-audit-denied',
          label: 'withAudit() — denied',
          description: 'Action throws AuditDeniedError. Outcome resolves to denied, error message becomes audit.reason.',
          color: 'error',
          onClick: async () => {
            await $fetch('/api/audit/with-audit', {
              method: 'POST',
              body: { scenario: 'denied' },
            })
          },
          badge: {
            label: 'outcome: denied',
            color: 'red',
          },
          toastOnSuccess: {
            title: 'withAudit() denied',
            description: 'AuditDeniedError → outcome=denied recorded with reason',
          },
        },
      ],
    } as TestSection,
    {
      id: 'catalogs',
      label: 'Catalogs',
      icon: 'i-lucide-book-open',
      title: 'Error & Audit Catalogs',
      description: 'Typed error and audit catalogs declared once in `server/utils/{errors,audit}.ts` and consumed everywhere. Every test below shows the round-trip: factory call → wire `code` / `action` → parseError on the client. The catalog files include `declare module \'evlog\'` augmentation, so `parseError(err).code` is typed as the exact union of registered codes.',
      layout: 'cards',
      tests: [
        {
          id: 'catalog-payment-declined',
          label: 'billingErrors.PAYMENT_DECLINED()',
          description: 'Catalog factory with full fields + cause + internal override. Branches on the typed `code` to confirm the round-trip wire format.',
          color: 'error',
          onClick: async () => {
            try {
              await $fetch('/api/test/catalog/payment-declined')
            } catch (err) {
              const error = parseError(err)
              const toast = useToast()
              toast.add({
                title: error.message,
                description:
                  error.code === 'billing.PAYMENT_DECLINED'
                    ? `Matched typed catalog code. Why: ${error.why}`
                    : error.why,
                color: 'error',
                actions: error.link
                  ? [{ label: 'Learn more', onClick: () => window.open(error.link, '_blank') }]
                  : undefined,
              })
              if (error.fix) console.info(`💡 Fix: ${error.fix}`)
              console.info(`[catalog] code = ${error.code}`)
            }
          },
          badge: { label: 'GET /api/test/catalog/payment-declined', color: 'red' },
        },
        {
          id: 'catalog-insufficient-funds',
          label: 'billingErrors.INSUFFICIENT_FUNDS({ available, required })',
          description: 'Templated message: server-side message function receives required typed params and the resulting wire message is fully interpolated.',
          color: 'error',
          onClick: async () => {
            try {
              await $fetch('/api/test/catalog/insufficient-funds')
            } catch (err) {
              const error = parseError(err)
              const toast = useToast()
              toast.add({
                title: error.message,
                description: error.fix,
                color: 'error',
              })
              console.info(`[catalog] code = ${error.code} — message interpolated by the catalog template`)
            }
          },
          badge: { label: 'Templated message', color: 'red' },
        },
        {
          id: 'catalog-fraud-detected',
          label: 'billingErrors.FRAUD_DETECTED()',
          description: 'Catalog `internal` defaults (`category`, `riskBand`) merged with call-site `internal` (`mlScore`, `sessionId`). The merged object lands on the terminal wide event under `error.internal` but never appears in the HTTP body.',
          color: 'warning',
          onClick: async () => {
            try {
              await $fetch('/api/test/catalog/fraud-detected')
            } catch (err) {
              const { data } = err as { data?: Record<string, unknown> }
              const serialized = JSON.stringify(data ?? {})
              const leaked = serialized.includes('mlScore') || serialized.includes('riskBand')
              if (leaked) {
                console.error('[catalog] internal context leaked into HTTP body — bug', data)
              } else {
                console.info('[catalog] HTTP body has no internal secrets — OK. Check terminal wide event for error.internal.', data)
              }
              const error = parseError(err)
              const toast = useToast()
              toast.add({
                title: error.message,
                description: `${error.why ?? ''} See terminal for error.internal merging proof.`,
                color: 'warning',
              })
            }
          },
          badge: { label: 'tags + internal defaults', color: 'orange' },
        },
        {
          id: 'catalog-standalone',
          label: 'RateLimited({ retryAfter })',
          description: '`defineError` standalone factory (no catalog bundle) — same call-site shape, useful for one-off errors or per-file org. The factory exposes `.code` for refactor-safe comparisons.',
          color: 'warning',
          onClick: async () => {
            try {
              await $fetch('/api/test/catalog/standalone')
            } catch (err) {
              const error = parseError(err)
              const toast = useToast()
              toast.add({
                title: error.message,
                description: `${error.why ?? ''} (code = ${error.code})`,
                color: 'warning',
              })
            }
          },
          badge: { label: 'defineError', color: 'orange' },
        },
        {
          id: 'catalog-audit-refund',
          label: 'billingAudit.INVOICE_REFUND(...)',
          description: 'Catalog audit emission. The wire `action` (`billing.INVOICE_REFUND`) and `target.type` (`invoice`) come from the catalog entry — no magic strings at the call site.',
          endpoint: '/api/audit/catalog/invoice-refund',
          method: 'POST',
          color: 'success',
          showResult: true,
          badge: { label: 'POST /api/audit/catalog/invoice-refund', color: 'green' },
          toastOnSuccess: {
            title: 'Catalog audit recorded',
            description: 'Check terminal wide event + .audit/ for action=billing.INVOICE_REFUND',
          },
        },
        {
          id: 'catalog-audit-subscription-cancel',
          label: 'billingAudit.SUBSCRIPTION_CANCEL(...)',
          description: 'Different entry, different `target.type` (`subscription`). Proves the type is fixed per entry, not per call site.',
          endpoint: '/api/audit/catalog/subscription-cancel',
          method: 'POST',
          color: 'success',
          showResult: true,
          badge: { label: 'POST /api/audit/catalog/subscription-cancel', color: 'green' },
          toastOnSuccess: {
            title: 'Catalog audit recorded',
            description: 'Check terminal wide event for action=billing.SUBSCRIPTION_CANCEL, target.type=subscription',
          },
        },
      ],
    } as TestSection,
    {
      id: 'structured-errors',
      label: 'Structured Errors',
      icon: 'i-lucide-shield-alert',
      title: 'Structured Error → Toast',
      description: 'This demonstrates how a structured createError() from the backend can be displayed as a toast in the frontend with all context (message, why, fix, link). Use “Error with internal” to verify internal-only fields: they appear in the terminal wide event under error.internal, never in the HTTP body.',
      layout: 'cards',
      tests: [
        {
          id: 'structured-error-toast',
          label: 'Trigger API Error',
          description: 'Server-side structured error displayed as a rich toast with context, suggested fix, and helpful links',
          color: 'error',
          onClick: async () => {
            try {
              await $fetch('/api/test/structured-error')
            } catch (err) {
              const error = parseError(err)
              const toast = useToast()
              toast.add({
                title: error.message,
                description: error.why,
                color: 'error',
                actions: error.link
                  ? [
                    {
                      label: 'Learn more',
                      onClick: () => {
                        window.open(error.link, '_blank')
                      },
                    }
                  ]
                  : undefined,
              })
              if (error.fix) {
                console.info(`💡 Fix: ${error.fix}`)
              }
            }
          },
          badge: {
            label: 'parseError()',
            color: 'red',
          },
        },
        {
          id: 'structured-error-internal',
          label: 'Error with internal',
          description: 'createError includes internal: { supportRef, gatewayCode, … } for logs only. Open the devtools console after click, then check the terminal wide event for error.internal.',
          color: 'warning',
          onClick: async () => {
            try {
              await $fetch('/api/test/error-internal')
            } catch (err) {
              const { data } = err as { data?: Record<string, unknown> }
              const serialized = JSON.stringify(data ?? {})
              const leaked
                = serialized.includes('playground-support-ref-EVL140')
                  || serialized.includes('proc_declined_simulated')
              if (leaked) {
                console.error(
                  '[playground] internal context leaked into HTTP body — this should not happen',
                  data,
                )
              } else {
                console.info(
                  '[playground] HTTP body has no internal secrets — OK. In the terminal, find this request and check error.internal (supportRef, gatewayCode).',
                  data,
                )
              }
              const error = parseError(err)
              const toast = useToast()
              toast.add({
                title: error.message,
                description: `${error.why ?? ''} See browser console for the HTTP body check.`,
                color: 'error',
                actions: error.link
                  ? [
                    {
                      label: 'Learn more',
                      onClick: () => {
                        window.open(error.link, '_blank')
                      },
                    }
                  ]
                  : undefined,
              })
            }
          },
          badge: {
            label: 'GET /api/test/error-internal',
            color: 'warning',
          },
        },
      ],
    } as TestSection,
    {
      id: 'tail-sampling',
      label: 'Tail Sampling',
      icon: 'i-lucide-filter',
      title: 'Tail Sampling',
      description: 'Test how tail sampling rescues logs that would be dropped by head sampling. Config: rates: { info: 10 } (only 10% logged by default).',
      layout: 'cards',
      tests: [
        {
          id: 'tail-fast-single',
          label: '1 Request',
          description: 'Fast requests - only ~10% will appear in logs.',
          endpoint: '/api/test/tail-sampling/fast',
          method: 'GET',
          color: 'neutral',
          badge: {
            label: 'Head Sampling Only (10%)',
            color: 'gray',
          },
        },
        {
          id: 'tail-fast-batch',
          label: '20 Requests',
          description: 'Fast requests - only ~10% will appear in logs.',
          color: 'neutral',
          onClick: async () => {
            await Promise.all(
              Array.from({ length: 20 }, () => $fetch('/api/test/tail-sampling/fast')),
            )
          },
          badge: {
            label: 'Head Sampling Only (10%)',
            color: 'gray',
          },
          toastOnSuccess: {
            title: '20 fast requests sent',
            description: 'Check terminal - only ~10% should be logged (head sampling)',
          },
        },
        {
          id: 'tail-slow',
          label: 'Slow Request',
          description: 'Slow requests (600ms) - always logged.',
          endpoint: '/api/test/tail-sampling/slow',
          method: 'GET',
          color: 'warning',
          badge: {
            label: 'Tail: Duration >= 500ms',
            color: 'warning',
          },
          toastOnSuccess: {
            title: 'Slow request completed',
            description: 'This should always be logged (duration >= 500ms)',
          },
        },
        {
          id: 'tail-error',
          label: 'Error Request',
          description: 'Error responses - always logged.',
          endpoint: '/api/test/tail-sampling/error',
          method: 'GET',
          color: 'error',
          badge: {
            label: 'Tail: Status >= 400',
            color: 'error',
          },
          toastOnError: {
            title: 'Error request triggered',
            description: 'This should always be logged (status >= 400)',
          },
        },
        {
          id: 'tail-critical',
          label: 'Critical Path',
          description: 'Critical paths (/api/test/critical/**) - always logged.',
          endpoint: '/api/test/critical/important',
          method: 'GET',
          color: 'warning',
          badge: {
            label: 'Tail: Path Pattern',
            color: 'warning',
          },
          toastOnSuccess: {
            title: 'Critical path request',
            description: 'This should always be logged (path matches /api/test/critical/**)',
          },
        },
        {
          id: 'tail-premium',
          label: 'Premium User Request',
          description: 'Premium users - always logged via custom Nitro hook.',
          endpoint: '/api/test/tail-sampling/premium',
          method: 'GET',
          color: 'success',
          badge: {
            label: 'Tail: Custom Hook',
            color: 'success',
          },
          toastOnSuccess: {
            title: 'Premium user request',
            description: 'This should always be logged (evlog:emit:keep hook)',
          },
        },
      ],
    } as TestSection,
    {
      id: 'signals',
      label: 'Signals',
      icon: 'i-lucide-scan-search',
      title: 'Signals (@evlog/signals)',
      description: 'Each request is judged by the signals in server/signals. Verdicts land on event.signals through drains, not in the console. Scripted answers unless AI_GATEWAY_API_KEY is set.',
      layout: 'cards',
      tests: [
        {
          id: 'signals-checkout-ok',
          label: 'Checkout: order created',
          description: 'A 200 with an order. silent-failure answers false, the event stays sampled.',
          endpoint: '/api/signals/checkout?outcome=ok',
          method: 'POST',
          color: 'success',
          badge: { label: 'silent-failure: false', color: 'success' },
        },
        {
          id: 'signals-checkout-silent',
          label: 'Checkout: silent failure',
          description: 'A 200 on the fallback path, no order. silent-failure keeps the event past sampling.',
          endpoint: '/api/signals/checkout?outcome=silent',
          method: 'POST',
          color: 'warning',
          badge: { label: 'keep: silent-failure', color: 'warning' },
        },
        {
          id: 'signals-checkout-upstream',
          label: 'Checkout: Stripe down',
          description: 'A 502 from a connection reset. fault: upstream, retryable: true, severity scored.',
          endpoint: '/api/signals/checkout?outcome=upstream',
          method: 'POST',
          color: 'error',
          badge: { label: 'fault: upstream', color: 'error' },
        },
        {
          id: 'signals-signup-invalid',
          label: 'Signup: bad email',
          description: 'A 400 on input that is wrong. fault: user, validation-bug: false.',
          endpoint: '/api/signals/signup?email=notanemail',
          method: 'POST',
          color: 'neutral',
          badge: { label: 'fault: user', color: 'gray' },
        },
        {
          id: 'signals-signup-bug',
          label: 'Signup: valid email rejected',
          description: 'A 400 on hugo+test@example.com. validation-bug: true, the event is kept.',
          endpoint: '/api/signals/signup?email=hugo%2Btest%40example.com',
          method: 'POST',
          color: 'warning',
          badge: { label: 'keep: validation-bug', color: 'warning' },
        },
        {
          id: 'signals-webhook-ignored',
          label: 'Webhook: unhandled type',
          description: 'A 200 to Stripe for an event type with no handler. webhook-ignored keeps it.',
          endpoint: '/api/signals/webhook?type=charge.refunded',
          method: 'POST',
          color: 'warning',
          badge: { label: 'keep: webhook-ignored', color: 'warning' },
        },
      ],
    } as TestSection,
    {
      id: 'pipeline',
      label: 'Pipeline',
      icon: 'i-lucide-layers',
      title: 'Drain Pipeline (Batching + Retry)',
      description: 'Events are buffered and sent in batches (size: 5, interval: 2s). Watch the terminal for batched drain output.',
      layout: 'cards',
      tests: [
        {
          id: 'pipeline-single',
          label: '1 Request',
          description: 'Single event - buffered until batch size (5) or interval (2s) is reached',
          endpoint: '/api/test/success',
          method: 'GET',
          badge: {
            label: 'Buffered',
            color: 'blue',
          },
          toastOnSuccess: {
            title: 'Event buffered',
            description: 'Check terminal - will flush after 2s or when 5 events accumulate',
          },
        },
        {
          id: 'pipeline-batch',
          label: 'Fire 10 Requests',
          description: 'Fires 10 requests in parallel - should produce 2 batches of 5 events',
          onClick: async () => {
            await Promise.all(
              Array.from({ length: 10 }, () => $fetch('/api/test/success')),
            )
          },
          badge: {
            label: '2 batches',
            color: 'green',
          },
          toastOnSuccess: {
            title: '10 requests sent',
            description: 'Check terminal - should see 2 batches of 5 events',
          },
        },
      ],
    } as TestSection,
    {
      id: 'browser-drain',
      label: 'Browser Drain',
      icon: 'i-lucide-globe',
      title: 'Browser Drain',
      description: 'Send browser logs to your server via fetch/sendBeacon. Events are batched and flushed automatically. Check the terminal for [BROWSER DRAIN] output.',
      layout: 'cards',
      tests: [
        {
          id: 'browser-drain-quick',
          label: 'Quick Setup',
          description: 'Creates a browser drain, pushes a single event, and flushes immediately.',
          color: 'primary',
          onClick: async () => {
            const drain = createHttpLogDrain({
              drain: { endpoint: '/api/test/browser-ingest' },
              pipeline: { batch: { size: 1, intervalMs: 500 } },
              autoFlush: false,
            })
            drain(makeDrainEvent('browser_drain_test'))
            await drain.flush()
          },
          badge: {
            label: 'fetch POST',
            color: 'blue',
          },
          toastOnSuccess: {
            title: 'Browser drain event sent',
            description: 'Check terminal for [BROWSER DRAIN] output',
          },
        },
        {
          id: 'browser-drain-batch',
          label: 'Batch 5 Events',
          description: 'Creates the drain, pushes 5 events, and flushes. Demonstrates batching.',
          color: 'success',
          onClick: async () => {
            const drain = createHttpLogDrain({
              drain: { endpoint: '/api/test/browser-ingest' },
              pipeline: { batch: { size: 10, intervalMs: 500 } },
              autoFlush: false,
            })
            for (let i = 0; i < 5; i++) {
              drain(makeDrainEvent('browser_batch_test', { index: i }))
            }
            await drain.flush()
          },
          badge: {
            label: '5 events batched',
            color: 'green',
          },
          toastOnSuccess: {
            title: '5 events batched and sent',
            description: 'Check terminal for [BROWSER DRAIN] output',
          },
        },
        {
          id: 'browser-drain-beacon',
          label: 'Auto-flush (Page Hidden)',
          description: 'Pushes events with autoFlush enabled. Switch tabs or navigate away to flush via sendBeacon.',
          color: 'warning',
          onClick: () => {
            const drain = createHttpLogDrain({
              drain: { endpoint: '/api/test/browser-ingest' },
              pipeline: { batch: { size: 25, intervalMs: 60000 } },
            })
            for (let i = 0; i < 3; i++) {
              drain(makeDrainEvent('browser_beacon_test', { index: i }))
            }
          },
          badge: {
            label: 'sendBeacon',
            color: 'warning',
          },
          toastOnSuccess: {
            title: 'Events buffered',
            description: 'Navigate away or switch tabs — events will flush via sendBeacon',
          },
        },
      ],
    } as TestSection,
    {
      id: 'better-auth',
      label: 'Better Auth',
      icon: 'i-simple-icons-betterauth',
      title: 'Better Auth Integration',
      description: 'Real Better Auth integration with SQLite. Sign up creates an account, sign in sets a session cookie, then all subsequent API calls include userId, user, and session on the wide event. Check the terminal output.',
      layout: 'cards',
      tests: [
        {
          id: 'ba-signup',
          label: 'Sign Up',
          description: 'Creates a new user account via Better Auth (email: demo@evlog.dev, password: playground123).',
          color: 'success',
          onClick: async () => {
            const { error } = await authClient.signUp.email({
              email: 'demo@evlog.dev',
              password: 'playground123',
              name: 'Hugo Richard',
            })
            if (error) {
              console.error('[better-auth] Sign up failed:', error.message)
            }
          },
          badge: {
            label: 'signUp.email()',
            color: 'green',
          },
        },
        {
          id: 'ba-signin',
          label: 'Sign In',
          description: 'Signs in with email/password. Sets a real session cookie for auto-identification.',
          color: 'primary',
          onClick: async () => {
            const { error } = await authClient.signIn.email({
              email: 'demo@evlog.dev',
              password: 'playground123',
            })
            if (error) {
              console.error('[better-auth] Sign in failed:', error.message)
            }
          },
          badge: {
            label: 'signIn.email()',
            color: 'blue',
          },
        },
        {
          id: 'ba-whoami',
          label: 'Who am I?',
          description: 'Calls an API route — the wide event in the terminal will include user identity if signed in.',
          endpoint: '/api/test/better-auth/whoami',
          method: 'GET',
          color: 'primary',
          showResult: true,
          badge: {
            label: 'GET /whoami',
            color: 'blue',
          },
        },
        {
          id: 'ba-wide-event',
          label: 'Wide Event (identified)',
          description: 'Triggers the full wide event demo — if signed in, user context is automatically included.',
          endpoint: '/api/test/wide-event',
          method: 'GET',
          color: 'primary',
          badge: {
            label: 'Wide Event + User',
            color: 'blue',
          },
          toastOnSuccess: {
            title: 'Wide event emitted',
            description: 'Check terminal — user fields should be present if session is active',
          },
        },
        {
          id: 'ba-signout',
          label: 'Sign Out',
          description: 'Signs out and clears the session. Subsequent requests will be anonymous.',
          color: 'error',
          onClick: async () => {
            await authClient.signOut()
          },
          badge: {
            label: 'signOut()',
            color: 'red',
          },
        },
      ],
    } as TestSection,
    {
      id: 'drains',
      label: 'Drains',
      icon: 'i-lucide-database',
      title: 'Log Drains',
      description: 'Test the drain adapters (Axiom, OTLP, PostHog). Events flow through the evlog:drain hook in server/plugins/evlog-drain.ts. Uncomment an adapter there to test it live.',
      layout: 'cards',
      tests: [
        {
          id: 'drain-test',
          label: 'Emit Drain Event',
          description: 'Triggers a wide event that flows through the evlog:drain hook. Check terminal output and any configured adapters.',
          endpoint: '/api/test/drain',
          method: 'GET',
          color: 'primary',
          showResult: true,
          badge: {
            label: 'evlog:drain',
            color: 'blue',
          },
        },
      ],
    } as TestSection,
    {
      id: 'services',
      label: 'Services',
      icon: 'i-lucide-network',
      title: 'Service Testing',
      description: 'Test different service configurations and watch the logs in your terminal. Look for [auth-service], [payment-service], etc.',
      layout: 'cards',
      tests: [
        {
          id: 'service-auth',
          label: 'Test POST /api/auth/login',
          description: 'Tests the auth-service configuration via route matching',
          endpoint: '/api/auth/login',
          method: 'POST',
          color: 'primary',
          showResult: true,
          badge: {
            label: '/api/auth/**',
            color: 'purple',
          },
        },
        {
          id: 'service-payment',
          label: 'Test POST /api/payment/process',
          description: 'Tests the payment-service configuration via route matching',
          endpoint: '/api/payment/process',
          method: 'POST',
          color: 'success',
          showResult: true,
          badge: {
            label: '/api/payment/**',
            color: 'green',
          },
        },
        {
          id: 'service-booking',
          label: 'Test POST /api/booking/create',
          description: 'Tests the booking-service configuration via route matching',
          endpoint: '/api/booking/create',
          method: 'POST',
          color: 'warning',
          showResult: true,
          badge: {
            label: '/api/booking/**',
            color: 'orange',
          },
        },
        {
          id: 'service-custom',
          label: 'Test GET /api/test/service-override',
          description: 'Tests explicit service override via useLogger parameter',
          endpoint: '/api/test/service-override',
          method: 'GET',
          color: 'primary',
          showResult: true,
          badge: {
            label: 'useLogger(event, \'...\')',
            color: 'sky',
          },
        },
        {
          id: 'service-default',
          label: 'Test GET /api/test/success',
          description: 'Tests the default service for unmatched routes',
          endpoint: '/api/test/success',
          method: 'GET',
          color: 'neutral',
          showResult: true,
          badge: {
            label: 'env.service fallback',
            color: 'gray',
          },
        },
      ],
    } as TestSection,
  ],
}
