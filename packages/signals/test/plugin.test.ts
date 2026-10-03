import type { EnrichContext, TailSamplingContext, WideEvent } from 'evlog'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineSignal } from '../src/define'
import { createSignals } from '../src/plugin'
import { fakeEvaluate, no, yes } from './helpers'

const fault = defineSignal({
  name: 'fault',
  when: e => (e.status ?? 0) >= 400,
  ask: 'Who is responsible for this failure?',
  choice: { upstream: 'A dependency failed', app: 'Our bug', client: 'Bad input' },
})

const silentFailure = defineSignal({
  name: 'silent-failure',
  when: e => e.status === 200 && e.path === '/api/checkout',
  ask: 'Returned 200, but the user left empty-handed',
  keep: v => v.value && v.confidence > 0.8,
})

const severity = defineSignal({
  name: 'severity',
  when: e => (e.status ?? 0) >= 500,
  ask: 'How urgent is this for on-call?',
  score: ['noise', 'watch', 'page'],
})

function event(fields: Record<string, unknown>): WideEvent {
  return { timestamp: '2026-09-29T00:00:00.000Z', level: 'info', service: 'test', environment: 'test', requestId: 'req-1', ...fields }
}

function enrichCtx(fields: Record<string, unknown>): EnrichContext {
  return { event: event(fields), request: { path: String(fields.path ?? '/') } }
}

function keepCtx(fields: Record<string, unknown>): TailSamplingContext {
  const { status, path, method, ...context } = fields
  return { status: status as number, path: path as string, method: method as string, duration: 12, context: { requestId: 'req-1', path, method, ...context }, shouldKeep: false }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createSignals enrich', () => {
  it('batches every due signal into one call and writes typed columns', async () => {
    const { evaluate, calls } = fakeEvaluate(yes, 'jev-1.13.0')
    const plugin = createSignals({ signals: [fault, silentFailure, severity], evaluate })

    const ctx = enrichCtx({ status: 503, path: '/api/pay', error: { name: 'ECONNRESET' } })
    await plugin.enrich!(ctx)

    expect(calls).toHaveLength(1)
    expect(Object.keys(calls[0]!.questions)).toEqual(['fault', 'severity'])
    expect(calls[0]!.model).toBe('typesafe-ai/jev')
    expect(ctx.event.signals).toEqual({
      fault: { value: 'upstream', confidence: 0.9 },
      severity: { value: 'page', score: 1.7, confidence: 0.8 },
    })
    expect(ctx.event).not.toHaveProperty('signalsModel')
    expect(plugin.stats()).toMatchObject({ calls: 1, skipped: 0, errors: 0 })
    expect(plugin.stats().inputTokens).toBeGreaterThan(0)
  })

  it('writes the model id only when stampModel is set', async () => {
    const { evaluate } = fakeEvaluate(yes, 'jev-1.13.0')
    const ctx = enrichCtx({ status: 503, path: '/api/pay' })
    await createSignals({ signals: [fault], evaluate, stampModel: true }).enrich!(ctx)
    expect(ctx.event.signalsModel).toBe('jev-1.13.0')
  })

  it('makes no call when no signal is due', async () => {
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({ signals: [fault, silentFailure], evaluate })
    const ctx = enrichCtx({ status: 200, path: '/api/users' })
    await plugin.enrich!(ctx)
    expect(calls).toHaveLength(0)
    expect(ctx.event.signals).toBeUndefined()
  })

  it('sends the event without signal columns as state, or a picked state', async () => {
    const first = fakeEvaluate(yes)
    await createSignals({ signals: [fault], evaluate: first.evaluate })
      .enrich!(enrichCtx({ status: 500, path: '/x', signals: { old: 1 }, signalsModel: 'm' }))
    expect(first.calls[0]!.state).toMatchObject({ status: 500, path: '/x' })
    expect(first.calls[0]!.state).not.toHaveProperty('signals')

    const second = fakeEvaluate(yes)
    await createSignals({ signals: [fault], evaluate: second.evaluate, state: e => ({ status: e.status, path: e.path }) })
      .enrich!(enrichCtx({ status: 500, path: '/x', secret: 'no' }))
    expect(second.calls[0]!.state).toEqual({ status: 500, path: '/x' })
  })

  it('serves repeated fingerprints from the cache', async () => {
    const cached = defineSignal({
      name: 'fault',
      when: e => (e.status ?? 0) >= 400,
      ask: 'Who is responsible for this failure?',
      choice: { upstream: 'A dependency failed', app: 'Our bug', client: 'Bad input' },
      cacheKey: e => `${e.path}:${(e.error as { name?: string } | undefined)?.name}`,
    })
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({ signals: [cached], evaluate })

    for (let i = 0; i < 3; i++) await plugin.enrich!(enrichCtx({ status: 500, path: '/api/pay', error: { name: 'ECONNRESET' } }))
    const other = enrichCtx({ status: 500, path: '/api/pay', error: { name: 'TypeError' } })
    await plugin.enrich!(other)

    expect(calls).toHaveLength(2)
    expect(plugin.stats()).toMatchObject({ calls: 2, cached: 2 })
    expect(other.event.signals).toEqual({ fault: { value: 'upstream', confidence: 0.9 } })
  })
})

describe('createSignals keep', () => {
  it('promotes past sampling and reuses the verdict in enrich without a second call', async () => {
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({ signals: [fault, silentFailure], evaluate })

    const tail = keepCtx({ status: 200, path: '/api/checkout', method: 'POST', order: null })
    await plugin.keep!(tail)
    expect(tail.shouldKeep).toBe(true)
    expect(Object.keys(calls[0]!.questions)).toEqual(['silent-failure'])

    const ctx = enrichCtx({ status: 200, path: '/api/checkout', method: 'POST', order: null })
    await plugin.enrich!(ctx)
    expect(calls).toHaveLength(1)
    expect(ctx.event.signals).toEqual({ 'silent-failure': { value: true, confidence: 0.94, kept: true } })
  })

  it('never drops: a negative verdict leaves shouldKeep untouched and still lands as a column', async () => {
    const { evaluate } = fakeEvaluate(no)
    const plugin = createSignals({ signals: [silentFailure], evaluate })

    const tail = keepCtx({ status: 200, path: '/api/checkout', method: 'POST' })
    await plugin.keep!(tail)
    expect(tail.shouldKeep).toBe(false)

    const ctx = enrichCtx({ status: 200, path: '/api/checkout', method: 'POST' })
    await plugin.enrich!(ctx)
    expect(ctx.event.signals).toEqual({ 'silent-failure': { value: false, confidence: 0.94 } })
  })

  it('only asks keep signals before sampling', async () => {
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({ signals: [fault, silentFailure], evaluate })
    await plugin.keep!(keepCtx({ status: 500, path: '/api/users', method: 'GET' }))
    expect(calls).toHaveLength(0)
  })
})

describe('createSignals fails open', () => {
  it('skips events past the per-minute budget and resumes in the next window', async () => {
    vi.useFakeTimers()
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({ signals: [fault], evaluate, budget: { perMinute: 1 } })

    await plugin.enrich!(enrichCtx({ status: 500, path: '/a' }))
    const skipped = enrichCtx({ status: 500, path: '/b' })
    await plugin.enrich!(skipped)
    expect(calls).toHaveLength(1)
    expect(skipped.event.signals).toBeUndefined()
    expect(plugin.stats()).toMatchObject({ calls: 1, skipped: 1 })

    vi.advanceTimersByTime(60_000)
    await plugin.enrich!(enrichCtx({ status: 500, path: '/c' }))
    expect(calls).toHaveLength(2)
  })

  it('opens the breaker after a failed call and closes it after the cooldown', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let fail = true
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({
      signals: [fault],
      budget: { cooldownMs: 30_000 },
      evaluate: (request) => {
        if (fail) return Promise.reject(new Error('429'))
        return evaluate(request)
      },
    })

    const failed = enrichCtx({ status: 500, path: '/a' })
    await plugin.enrich!(failed)
    expect(failed.event.signals).toBeUndefined()
    expect(plugin.stats()).toMatchObject({ errors: 1 })

    fail = false
    await plugin.enrich!(enrichCtx({ status: 500, path: '/b' }))
    expect(calls).toHaveLength(0)
    expect(plugin.stats()).toMatchObject({ skipped: 1 })

    vi.advanceTimersByTime(30_000)
    const ok = enrichCtx({ status: 500, path: '/c' })
    await plugin.enrich!(ok)
    expect(calls).toHaveLength(1)
    expect(ok.event.signals).toEqual({ fault: { value: 'upstream', confidence: 0.9 } })
  })

  it('aborts a slow call at the timeout', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = createSignals({
      signals: [fault],
      timeoutMs: 2_000,
      evaluate: ({ abortSignal }) => new Promise((_, reject) => {
        abortSignal.addEventListener('abort', () => reject(abortSignal.reason))
      }),
    })

    const ctx = enrichCtx({ status: 500, path: '/slow' })
    const done = plugin.enrich!(ctx)
    vi.advanceTimersByTime(2_000)
    await done
    expect(ctx.event.signals).toBeUndefined()
    expect(plugin.stats()).toMatchObject({ errors: 1, calls: 0 })
  })

  it('skips events whose state exceeds maxStateChars', async () => {
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({ signals: [fault], evaluate, maxStateChars: 200 })
    await plugin.enrich!(enrichCtx({ status: 500, path: '/big', body: 'x'.repeat(500) }))
    expect(calls).toHaveLength(0)
    expect(plugin.stats()).toMatchObject({ skipped: 1 })
  })

  it('rejects duplicate signal names at construction', () => {
    expect(() => createSignals({ signals: [fault, fault], evaluate: fakeEvaluate(yes).evaluate })).toThrow(/duplicate signal name/)
  })
})
