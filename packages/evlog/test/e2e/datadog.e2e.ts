/**
 * E2E smoke test for the Datadog adapter.
 *
 * The Logs intake is write-only for an API key (reading back needs an
 * application key too), so this is a smoke test like Better Stack's, with one
 * addition: `fetch` passes through to Datadog while the suite keeps each
 * request, so the gzip body that Datadog answered 202 to is decoded and checked
 * for the `httpStatusCode` renaming, the `dd` trace block and the 1000-entry split.
 *
 * Required env vars:
 *   - DATADOG_API_KEY
 * Optional:
 *   - DATADOG_SITE, e.g. datadoghq.eu. Default: datadoghq.com
 */
import { gunzipSync } from 'node:zlib'
import { expect } from 'vitest'
import { sendBatchToDatadog } from '../../src/adapters/datadog'
import type { RecordedRequest } from './_shared'
import { describeIfEnv, itWithCorrelationId, makeEvent, readEnv, recordFetch } from './_shared'

function decodeBody(request: RecordedRequest): Array<Record<string, any>> {
  return JSON.parse(gunzipSync(request.body as Uint8Array).toString('utf8'))
}

describeIfEnv('datadog e2e (smoke)', ['DATADOG_API_KEY'], () => {
  const apiKey = readEnv('DATADOG_API_KEY')!
  const site = readEnv('DATADOG_SITE')

  itWithCorrelationId('Logs intake accepts info / warn / error logs', async () => {
    const events = (['info', 'warn', 'error'] as const).map(level =>
      makeEvent('datadog-smoke', { level, message: `e2e ${level} log from evlog tests` }),
    )

    await expect(sendBatchToDatadog(events, { apiKey, site })).resolves.toBeUndefined()
  }, 30_000)

  itWithCorrelationId('accepts the gzip body with httpStatusCode and the dd trace block', async () => {
    const event = makeEvent('datadog-wire', {
      level: 'error',
      method: 'POST',
      path: '/api/checkout',
      status: 502,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      error: { name: 'UpstreamError', message: 'payment provider down', status: 502 },
    })

    const recorder = recordFetch()
    try {
      await sendBatchToDatadog([event], { apiKey, site })
    } finally {
      recorder.restore()
    }

    const [request] = recorder.requests
    expect(recorder.requests).toHaveLength(1)
    expect(request?.status).toBe(202)
    expect(request?.headers.get('content-encoding')).toBe('gzip')

    const [log] = decodeBody(request!)
    expect(log).toMatchObject({
      status: 'error',
      service: 'evlog-e2e',
      ddsource: 'evlog',
      ddtags: 'env:test',
      dd: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7' },
      timestamp: Date.parse(event.timestamp),
      evlog: {
        e2e_correlation_id: event.e2e_correlation_id,
        httpStatusCode: 502,
        error: { name: 'UpstreamError', httpStatusCode: 502 },
      },
    })
    expect(log?.evlog.status).toBeUndefined()
    expect(log?.evlog.error.status).toBeUndefined()
  }, 30_000)

  itWithCorrelationId('splits a 1001-event batch into two requests that are both accepted', async () => {
    const events = Array.from({ length: 1001 }, (_, index) => makeEvent('datadog-split', { index }))

    const recorder = recordFetch()
    try {
      await sendBatchToDatadog(events, { apiKey, site })
    } finally {
      recorder.restore()
    }

    expect(recorder.requests.map(request => request.status)).toEqual([202, 202])
    const batches = recorder.requests.map(decodeBody)
    expect(batches.map(batch => batch.length)).toEqual([1000, 1])
    expect(batches.flat().map(log => log.evlog.e2e_correlation_id)).toEqual(events.map(event => event.e2e_correlation_id))
  }, 60_000)

  itWithCorrelationId('rejects an invalid API key', async () => {
    await expect(
      sendBatchToDatadog([makeEvent('datadog-invalid-key')], { apiKey: 'invalid-key-for-e2e', site, retries: 0 }),
    ).rejects.toThrow(/403/)
  }, 30_000)
})
