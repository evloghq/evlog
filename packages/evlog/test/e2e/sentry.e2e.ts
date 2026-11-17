/**
 * E2E smoke test for the Sentry adapter.
 *
 * The Sentry DSN is write-only, so we cannot read events back. Instead we send
 * to the real Envelope endpoint and assert no HTTP error. Sentry returns
 * 200 with `{"id": "..."}` on success — `httpPost` only throws on non-2xx,
 * so absence of error == acceptance.
 *
 * Required env vars:
 *   - SENTRY_DSN
 */
import { Effect } from 'effect'
import { expect, vi } from 'vitest'
import { createSentryDrain, sendBatchToSentry, toSentryLog } from '../../src/adapters/sentry'
import { EvlogLogger, withLogger } from '../../src/effect/index'
import { initLogger } from '../../src/logger'
import type { WideEvent } from '../../src/types'
import { describeIfEnv, itWithCorrelationId, makeEvent, makeTags, readEnv, recordFetch } from './_shared'

describeIfEnv('sentry e2e (smoke)', ['SENTRY_DSN'], () => {
  const dsn = readEnv('SENTRY_DSN')!

  itWithCorrelationId('Sentry envelope endpoint accepts info / warn / error logs', async () => {
    const events = (['info', 'warn', 'error'] as const).map(level =>
      makeEvent('sentry-smoke', {
        level,
        message: `e2e ${level} log from evlog tests`,
      }),
    )

    await expect(sendBatchToSentry(events, { dsn })).resolves.toBeUndefined()
  }, 30_000)

  itWithCorrelationId('toSentryLog produces a payload Sentry accepts', async () => {
    const event = makeEvent('sentry-shape', {
      level: 'error',
      message: 'shape check',
      userId: 'e2e-user',
      cart: { items: 3, total: 9999 },
    })

    const log = toSentryLog(event, { dsn })
    expect(log.body).toBeTruthy()
    expect(log.level).toBe('error')
    expect(typeof log.timestamp).toBe('number')
    expect(typeof log.trace_id).toBe('string')
    expect(log.attributes?.service).toBeDefined()
    expect(log.attributes?.['sentry.sdk.name']).toEqual({ value: 'evlog', type: 'string' })
    expect(log.attributes?.['sentry.sdk.version']?.type).toBe('string')

    await expect(sendBatchToSentry([event], { dsn })).resolves.toBeUndefined()
  }, 30_000)

  // Issue requests are best-effort and never reject, so acceptance is the absence of the failure log.
  itWithCorrelationId('Sentry envelope endpoint accepts an error sent as an issue', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = makeEvent('sentry-issue', {
      level: 'error',
      message: 'e2e issue from evlog tests',
      method: 'GET',
      path: '/e2e/issue',
      error: { name: 'EvlogE2EError', message: 'e2e issue from evlog tests', stack: new Error('e2e issue from evlog tests').stack },
    })

    try {
      await expect(sendBatchToSentry([event], { dsn, issues: true })).resolves.toBeUndefined()
      expect(consoleSpy).not.toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
    }
  }, 30_000)

  itWithCorrelationId('a failed evlog/effect unit sends its issue and log with the wide event trace id', async () => {
    initLogger({ env: { service: 'evlog-e2e', environment: 'test' }, silent: true })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sentry = createSentryDrain({ dsn, issues: true })
    const tags = makeTags('sentry-effect-trace')
    let wide: WideEvent | undefined

    const failingTurn = Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.set(tags)
      return yield* Effect.fail(new Error('e2e effect unit failed'))
    })

    const recorder = recordFetch()
    try {
      await Effect.runPromiseExit(failingTurn.pipe(withLogger('turn', {
        drain: async (ctx) => {
          wide = ctx.event
          await sentry(ctx)
        },
      })))
      expect(consoleSpy).not.toHaveBeenCalled()
    } finally {
      recorder.restore()
      consoleSpy.mockRestore()
    }

    const items = recorder.requests.map((request) => {
      const [, header, payload] = String(request.body).split('\n')
      return { status: request.status, type: JSON.parse(header!).type as string, payload: JSON.parse(payload!) }
    })
    expect(items.map(item => [item.type, item.status])).toEqual([['log', 200], ['event', 200]])

    const traceId = wide?.traceId
    expect(traceId).toMatch(/^[\da-f]{32}$/)
    expect(wide?.e2e_correlation_id).toBe(tags.e2e_correlation_id)
    const [log] = items[0]!.payload.items
    const issue = items[1]!.payload
    expect(log.trace_id).toBe(traceId)
    expect(issue.contexts.trace).toMatchObject({ trace_id: traceId, span_id: wide?.spanId })
    expect(issue.exception.values[0]).toMatchObject({ value: 'e2e effect unit failed' })
  }, 30_000)

  itWithCorrelationId('rejects an invalid DSN', async () => {
    await expect(
      sendBatchToSentry([makeEvent('sentry-invalid-dsn')], {
        dsn: 'https://invalid@o0.ingest.sentry.io/999999999',
      }),
    ).rejects.toThrow()
  }, 30_000)
})
