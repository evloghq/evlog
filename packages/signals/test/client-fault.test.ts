import type { EnrichContext, WideEvent } from 'evlog'
import { initLogger } from 'evlog'
import { createMiddlewareLogger } from 'evlog/toolkit'
import { describe, expect, it, vi } from 'vitest'
import { clientFault } from '../src/client-fault'
import { defineSignal } from '../src/define'
import { createSignals } from '../src/plugin'
import { answers, scriptedEvaluate } from '../src/testing'

/** The event `_evlog/ingest` builds from a browser log: the payload, the server's environment, `source: 'client'`. */
function clientEvent(fields: Record<string, unknown>): EnrichContext {
  const event = { timestamp: '2026-11-20T10:00:00.000Z', level: 'error', service: 'shop', environment: 'production', source: 'client', ...fields } as WideEvent
  return { event, request: { method: 'POST', path: '/api/_evlog/ingest' } }
}

const network = scriptedEvaluate((_name, question) => question.type === 'choice' ? answers.choice(question, 'network', 0.91) : answers.first(question))

describe('clientFault', () => {
  it('judges client errors only, and writes one of its four options', async () => {
    const { evaluate, calls } = network
    calls.length = 0
    const plugin = createSignals({ name: 'client-signals', signals: [clientFault], evaluate })

    const failed = clientEvent({ error: { name: 'TypeError', message: 'Failed to fetch' } })
    await plugin.enrich(failed)
    for (const skipped of [
      clientEvent({ level: 'warn', error: { name: 'TypeError', message: 'Failed to fetch' } }),
      clientEvent({ level: 'info', tag: 'cart', message: 'opened' }),
      clientEvent({ source: undefined, status: 500, error: { name: 'Error', message: 'db down' } }),
    ]) await plugin.enrich(skipped)

    expect(calls).toHaveLength(1)
    expect(Object.keys((calls[0]!.questions['client-fault'] as { criteria: Record<string, string> }).criteria)).toEqual(['app', 'network', 'third-party', 'browser'])
    expect((failed.event.signals as Record<string, unknown>)['client-fault']).toEqual({ value: 'network', confidence: 0.91 })
  })

  it('shares one verdict across a flood of the same error, and tells tagged messages apart', async () => {
    const evaluate = vi.fn(network.evaluate)
    const plugin = createSignals({ signals: [clientFault], evaluate })

    for (let i = 0; i < 20; i++) await plugin.enrich(clientEvent({ requestId: `r${i}`, userId: `u${i}`, error: { name: 'TypeError', message: 'Failed to fetch', stack: `at line ${i}` } }))
    await plugin.enrich(clientEvent({ level: 'fatal', tag: 'checkout', message: 'stripe.js did not load' }))
    await plugin.enrich(clientEvent({ tag: 'checkout', message: 'stripe.js did not load' }))
    await plugin.enrich(clientEvent({ tag: 'checkout: step', message: 'failed' }))
    await plugin.enrich(clientEvent({ tag: 'checkout', message: 'step: failed' }))
    await plugin.enrich(clientEvent({ error: { name: 'checkout', message: 'stripe.js did not load' } }))

    expect(evaluate).toHaveBeenCalledTimes(5)
    expect(plugin.stats()).toMatchObject({ calls: 5, cached: 20 })
  })
})

describe('createSignals name', () => {
  it('lets a second instance run beside the first in evlog\'s plugin runner', async () => {
    initLogger({ pretty: false, silent: true })
    const fault = defineSignal({ name: 'fault', when: e => (e.status ?? 0) >= 500, ask: 'Who failed?', choice: { app: 'Our bug', upstream: 'A dependency' } })
    const slow = defineSignal({ name: 'slow', when: e => (e.status ?? 0) >= 500, ask: 'Was it slow?' })
    const drain = vi.fn()
    const { finish } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/pay',
      drain,
      plugins: [
        createSignals({ signals: [fault], evaluate: network.evaluate }),
        createSignals({ name: 'client-signals', signals: [slow], evaluate: network.evaluate }),
      ],
    })

    await finish({ status: 503 })

    const event = drain.mock.calls[0]![0].event as WideEvent
    expect(Object.keys(event.signals as Record<string, unknown>)).toEqual(['fault', 'slow'])
  })
})
