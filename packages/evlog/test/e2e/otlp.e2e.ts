/**
 * E2E test for the OTLP adapter.
 *
 * Round-trip against the OpenTelemetry Collector in the local sandbox: the
 * collector decodes each request (OTLP/JSON or protobuf, plain or gzip) and
 * writes what it accepted to a file, which the suite reads back. A payload the
 * reference implementation cannot decode fails here, and HyperDX, PostHog
 * (logs mode) and Sazabi all send this same payload.
 *
 *   pnpm run sandbox:up
 *   pnpm run sandbox:e2e
 *
 * Required env vars:
 *   - OTLP_ENDPOINT (the collector's OTLP/HTTP base URL, e.g. http://localhost:4318)
 *   - OTLP_EXPORT_FILE (the file the collector's file exporter writes)
 */
import { expect } from 'vitest'
import { createRequestLogger, initLogger } from '../../src/logger'
import { createDrainPipeline } from '../../src/pipeline'
import type { DrainContext } from '../../src/types'
import { createOTLPDrain, sendBatchToOTLP } from '../../src/adapters/otlp'
import { attributeValue, describeIfEnv, itWithCorrelationId, makeEvent, makeTags, readEnv, waitForCollectedRecord } from './_shared'

describeIfEnv('otlp e2e (round-trip)', ['OTLP_ENDPOINT', 'OTLP_EXPORT_FILE'], () => {
  const endpoint = readEnv('OTLP_ENDPOINT')!
  const file = readEnv('OTLP_EXPORT_FILE')!

  itWithCorrelationId('the collector accepts an OTLP/JSON record and keeps its fields', async () => {
    const event = makeEvent('otlp-json', {
      level: 'error',
      version: '1.2.3',
      method: 'POST',
      path: '/api/checkout',
      status: 500,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      cart: { items: 3, total: 99.5 },
      error: { name: 'PaymentError', message: 'card declined' },
    })

    await sendBatchToOTLP([event], { endpoint })

    const { resource, scope, record } = await waitForCollectedRecord(file, event.e2e_correlation_id, 'otlp-json')
    expect(resource).toMatchObject({ 'service.name': 'evlog-e2e', 'deployment.environment': 'test', 'service.version': '1.2.3' })
    expect(scope.name).toBe('evlog')
    expect(scope.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(record).toMatchObject({
      severityNumber: 17,
      severityText: 'ERROR',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      timeUnixNano: String(Date.parse(event.timestamp) * 1_000_000),
    })
    expect(JSON.parse(record.body.stringValue)).toEqual(event)
    expect(attributeValue(record.attributes, 'status')).toBe(500)
    expect(attributeValue(record.attributes, 'cart')).toEqual({
      values: [
        { key: 'items', value: { intValue: '3' } },
        { key: 'total', value: { doubleValue: 99.5 } },
      ],
    })
    expect(attributeValue(record.attributes, 'traceId')).toBeUndefined()
  }, 30_000)

  itWithCorrelationId('the collector decodes gzip protobuf with compact records and semantic conventions', async () => {
    const event = makeEvent('otlp-protobuf', {
      level: 'warn',
      method: 'GET',
      path: '/api/search?q=shoes',
      status: 404,
      user: { id: 'user_1', plan: 'pro' },
    })

    await sendBatchToOTLP([event], {
      endpoint,
      protocol: 'http/protobuf',
      compression: 'gzip',
      recordShape: 'compact',
      semanticConventions: true,
    })

    const { resource, record } = await waitForCollectedRecord(file, event.e2e_correlation_id, 'otlp-protobuf')
    expect(resource['deployment.environment.name']).toBe('test')
    expect(record).toMatchObject({ severityNumber: 13, severityText: 'WARN' })
    expect(record.body.stringValue).not.toMatch(/^\{/)
    expect(attributeValue(record.attributes, 'user.id')).toBe('user_1')
    expect(attributeValue(record.attributes, 'user.plan')).toBe('pro')
    expect(attributeValue(record.attributes, 'http.request.method')).toBe('GET')
    expect(attributeValue(record.attributes, 'url.path')).toBe('/api/search')
    expect(attributeValue(record.attributes, 'http.response.status_code')).toBe(404)
  }, 30_000)

  itWithCorrelationId('gives each service in a batch its own resource', async () => {
    const events = ['evlog-e2e-api', 'evlog-e2e-worker'].map(service => makeEvent('otlp-resources', { service }))

    await sendBatchToOTLP(events, { endpoint })

    for (const event of events) {
      const { resource } = await waitForCollectedRecord(file, event.e2e_correlation_id, 'otlp-resources')
      expect(resource['service.name']).toBe(event.service)
    }
  }, 30_000)

  itWithCorrelationId('delivers request wide events from initLogger through the drain and its headers', async () => {
    const drain = createDrainPipeline<DrainContext>({ batch: { size: 100, intervalMs: 60_000 } })(
      createOTLPDrain({ endpoint, headers: { Authorization: 'Bearer e2e-otlp-token' } }),
    )
    initLogger({ env: { service: 'evlog-e2e', environment: 'test' }, silent: true, drain })

    const tags = makeTags('otlp-drain')
    const log = createRequestLogger({ method: 'GET', path: '/api/orders' })
    log.set(tags)
    log.emit({ status: 200 })
    await drain.flush()

    const { record } = await waitForCollectedRecord(file, tags.e2e_correlation_id, 'otlp-drain')
    expect(attributeValue(record.attributes, 'path')).toBe('/api/orders')
    expect(attributeValue(record.attributes, 'e2e.request.authorization')).toBe('Bearer e2e-otlp-token')
  }, 30_000)

  itWithCorrelationId('rejects a URL the collector does not serve', async () => {
    await expect(
      sendBatchToOTLP([makeEvent('otlp-bad-path')], { endpoint: `${endpoint}/not-otlp`, retries: 0 }),
    ).rejects.toThrow(/404/)
  }, 30_000)
})
