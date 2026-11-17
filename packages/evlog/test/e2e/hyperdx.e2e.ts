/**
 * E2E tests for the HyperDX adapter.
 *
 * `createHyperDXDrain()` maps its config onto the OTLP encoder and sends the API
 * key as the `authorization` header, so two suites:
 *
 *   1. Round-trip against the sandbox OpenTelemetry Collector: the record and
 *      the header the collector received are read back from its export file.
 *   2. Smoke against HyperDX cloud. The intake answers 200 even for an invalid
 *      key, so acceptance only proves the payload and endpoint path are right.
 *
 * Required env vars:
 *   - OTLP_ENDPOINT + OTLP_EXPORT_FILE (sandbox round-trip, see otlp.e2e.ts)
 *   - HYPERDX_API_KEY (cloud smoke)
 * Optional:
 *   - HYPERDX_OTLP_ENDPOINT (self-hosted HyperDX instead of in-otel.hyperdx.io)
 */
import { expect } from 'vitest'
import { createRequestLogger, initLogger } from '../../src/logger'
import { createDrainPipeline } from '../../src/pipeline'
import type { DrainContext } from '../../src/types'
import { createHyperDXDrain, sendBatchToHyperDX } from '../../src/adapters/hyperdx'
import { attributeValue, describeIfEnv, itWithCorrelationId, makeEvent, makeTags, readEnv, waitForCollectedRecord } from './_shared'

describeIfEnv('hyperdx e2e (round-trip via the sandbox collector)', ['OTLP_ENDPOINT', 'OTLP_EXPORT_FILE'], () => {
  const endpoint = readEnv('OTLP_ENDPOINT')!
  const file = readEnv('OTLP_EXPORT_FILE')!

  itWithCorrelationId('sends the API key as the authorization header with the configured service name', async () => {
    const event = makeEvent('hyperdx-collector', { level: 'warn', path: '/api/hyperdx', status: 429 })

    await sendBatchToHyperDX([event], {
      apiKey: 'e2e-hyperdx-key',
      endpoint,
      serviceName: 'evlog-e2e-hyperdx',
      resourceAttributes: { 'e2e.suite': 'hyperdx' },
    })

    const { resource, record } = await waitForCollectedRecord(file, event.e2e_correlation_id, 'hyperdx-collector')
    expect(resource).toMatchObject({ 'service.name': 'evlog-e2e-hyperdx', 'e2e.suite': 'hyperdx' })
    expect(record.severityText).toBe('WARN')
    expect(attributeValue(record.attributes, 'e2e.request.authorization')).toBe('e2e-hyperdx-key')
    expect(attributeValue(record.attributes, 'status')).toBe(429)
  }, 30_000)

  itWithCorrelationId('delivers request wide events from initLogger through createHyperDXDrain', async () => {
    const drain = createDrainPipeline<DrainContext>({ batch: { size: 100, intervalMs: 60_000 } })(
      createHyperDXDrain({ apiKey: 'e2e-hyperdx-key', endpoint }),
    )
    initLogger({ env: { service: 'evlog-e2e', environment: 'test' }, silent: true, drain })

    const tags = makeTags('hyperdx-drain')
    const log = createRequestLogger({ method: 'POST', path: '/api/hyperdx' })
    log.set(tags)
    log.emit({ status: 201 })
    await drain.flush()

    const { resource, record } = await waitForCollectedRecord(file, tags.e2e_correlation_id, 'hyperdx-drain')
    expect(resource['service.name']).toBe('evlog-e2e')
    expect(attributeValue(record.attributes, 'method')).toBe('POST')
  }, 30_000)
})

describeIfEnv('hyperdx e2e (cloud smoke)', ['HYPERDX_API_KEY'], () => {
  const apiKey = readEnv('HYPERDX_API_KEY')!
  const endpoint = readEnv('HYPERDX_OTLP_ENDPOINT')

  itWithCorrelationId('HyperDX intake accepts info / warn / error logs', async () => {
    const events = (['info', 'warn', 'error'] as const).map(level =>
      makeEvent('hyperdx-smoke', { level, message: `e2e ${level} log from evlog tests` }),
    )

    await expect(sendBatchToHyperDX(events, { apiKey, endpoint })).resolves.toBeUndefined()
  }, 30_000)
})
