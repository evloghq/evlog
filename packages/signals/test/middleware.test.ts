import type { WideEvent } from 'evlog'
import { initLogger } from 'evlog'
import { createMiddlewareLogger } from 'evlog/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineSignal } from '../src/define'
import { createSignals } from '../src/plugin'
import { fakeEvaluate, no, yes } from './helpers'

const silentFailure = defineSignal({
  name: 'silent-failure',
  when: e => e.status === 200 && e.path === '/api/checkout',
  ask: 'Returned 200, but the user left empty-handed',
  keep: v => v.value && v.confidence > 0.8,
})

const fault = defineSignal({
  name: 'fault',
  when: e => (e.status ?? 0) >= 400,
  ask: 'Who is responsible for this failure?',
  choice: { upstream: 'A dependency failed', app: 'Our bug', client: 'Bad input' },
})

beforeEach(() => {
  initLogger({ pretty: false, redact: false, silent: true, sampling: { rates: { info: 0 } } })
})

describe('through evlog middleware', () => {
  it('promotes a sampled-out request and drains it with the verdict attached', async () => {
    const { evaluate, calls } = fakeEvaluate(yes, 'jev-1.13.0')
    const drain = vi.fn()
    const { logger, finish } = createMiddlewareLogger({
      method: 'POST',
      path: '/api/checkout',
      drain,
      plugins: [createSignals({ signals: [silentFailure, fault], evaluate })],
    })
    logger.set({ payment: { provider: 'stripe', fallback: true } })

    const event = await finish({ status: 200 })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.state).toMatchObject({ path: '/api/checkout', status: 200, payment: { provider: 'stripe', fallback: true } })
    expect(event).not.toBeNull()
    expect(drain).toHaveBeenCalledTimes(1)
    const drained = drain.mock.calls[0]![0].event as WideEvent
    expect(drained.signals).toEqual({ 'silent-failure': { value: true, confidence: 0.94, kept: true } })
    expect(drained).not.toHaveProperty('signalsModel')
  })

  it('lets sampling drop the request when the keep signal says no', async () => {
    const { evaluate, calls } = fakeEvaluate(no)
    const drain = vi.fn()
    const { finish } = createMiddlewareLogger({
      method: 'POST',
      path: '/api/checkout',
      drain,
      plugins: [createSignals({ signals: [silentFailure], evaluate })],
    })

    const event = await finish({ status: 200 })
    expect(calls).toHaveLength(1)
    expect(event).toBeNull()
    expect(drain).not.toHaveBeenCalled()
  })

  it('judges errors after the response and keeps the request path untouched on failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const drain = vi.fn()
    const { finish } = createMiddlewareLogger({
      method: 'GET',
      path: '/api/users',
      drain,
      plugins: [createSignals({ signals: [fault], evaluate: () => Promise.reject(new Error('down')) })],
    })

    const event = await finish({ error: Object.assign(new Error('boom'), { statusCode: 502 }) })
    expect(event).not.toBeNull()
    expect(drain).toHaveBeenCalledTimes(1)
    const drained = drain.mock.calls[0]![0].event as WideEvent
    expect(drained.signals).toBeUndefined()
    expect(drained.status).toBe(502)
  })
})
