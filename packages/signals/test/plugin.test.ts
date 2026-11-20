import type { EnrichContext, TailSamplingContext, WideEvent } from 'evlog'
import { Experimental_DecisionRefusalError } from 'ai'
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
  it('keeps the verdicts it got when the response omits one question', async () => {
    const scripted = fakeEvaluate(yes)
    const plugin = createSignals({
      signals: [fault, severity],
      evaluate: async (request) => {
        const response = await scripted.evaluate(request)
        const { severity: _dropped, ...answers } = response.answers
        return { ...response, answers }
      },
    })

    const ctx = enrichCtx({ status: 503, path: '/api/pay' })
    await plugin.enrich!(ctx)

    expect(ctx.event.signals).toEqual({ fault: { value: 'upstream', confidence: 0.9 } })
    expect(plugin.stats()).toMatchObject({ calls: 1, errors: 0 })
  })

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

  it('makes one call for concurrent events sharing a cacheKey', async () => {
    const cached = defineSignal({
      name: 'fault',
      when: e => (e.status ?? 0) >= 400,
      ask: 'Who is responsible for this failure?',
      choice: { upstream: 'A dependency failed', app: 'Our bug', client: 'Bad input' },
      cacheKey: e => String(e.path),
    })
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({
      signals: [cached, severity],
      budget: { maxConcurrent: 50 },
      evaluate: async (request) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return evaluate(request)
      },
    })

    const storm = Array.from({ length: 50 }, (_, i) => enrichCtx({ status: 502, path: '/api/pay', requestId: `req-${i}` }))
    await Promise.all(storm.map(ctx => plugin.enrich!(ctx)))

    expect(calls.filter(c => 'fault' in c.questions)).toHaveLength(1)
    expect(calls).toHaveLength(50)
    expect(plugin.stats()).toMatchObject({ cached: 49 })
    for (const ctx of storm) expect((ctx.event.signals as Record<string, unknown>).fault).toEqual({ value: 'upstream', confidence: 0.9 })
  })
})

describe('createSignals shared calls', () => {
  const keyed = defineSignal({
    name: 'fault',
    when: e => (e.status ?? 0) >= 400,
    ask: 'Who is responsible for this failure?',
    choice: { upstream: 'A dependency failed', app: 'Our bug', client: 'Bad input' },
    cacheKey: e => String(e.path),
  })

  it('stamps the model id on events that joined a running call', async () => {
    const { evaluate } = fakeEvaluate(yes, 'jev-1.13.0')
    const plugin = createSignals({
      signals: [keyed],
      stampModel: true,
      evaluate: async (request) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return evaluate(request)
      },
    })

    const both = [enrichCtx({ status: 502, path: '/api/pay', requestId: 'a' }), enrichCtx({ status: 502, path: '/api/pay', requestId: 'b' })]
    await Promise.all(both.map(ctx => plugin.enrich!(ctx)))
    expect(both.map(ctx => ctx.event.signalsModel)).toEqual(['jev-1.13.0', 'jev-1.13.0'])
  })

  it('does not share a state-size skip with a same-key event whose state fits', async () => {
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({ signals: [keyed], evaluate, maxStateChars: 200 })

    const oversized = enrichCtx({ status: 502, path: '/api/pay', requestId: 'a', body: 'x'.repeat(500) })
    const fits = enrichCtx({ status: 502, path: '/api/pay', requestId: 'b' })
    await Promise.all([plugin.enrich!(oversized), plugin.enrich!(fits)])

    expect(oversized.event.signals).toBeUndefined()
    expect(fits.event.signals).toEqual({ fault: { value: 'upstream', confidence: 0.9 } })
    expect(calls).toHaveLength(1)
    expect(plugin.stats()).toMatchObject({ skipped: 1, calls: 1 })
  })

  it('lets the next event retry a key whose call failed before reaching the model', async () => {
    const { evaluate, calls } = fakeEvaluate(yes)
    let throwing = true
    const plugin = createSignals({
      signals: [keyed],
      evaluate,
      state: (e) => {
        if (throwing) throw new Error('unserializable')
        return { status: e.status, path: e.path }
      },
    })

    const joined = enrichCtx({ status: 502, path: '/api/pay', requestId: 'b' })
    const results = await Promise.allSettled([plugin.enrich!(enrichCtx({ status: 502, path: '/api/pay', requestId: 'a' })), plugin.enrich!(joined)])
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected'])
    expect(joined.event.signals).toBeUndefined()

    throwing = false
    const retried = enrichCtx({ status: 502, path: '/api/pay', requestId: 'c' })
    await plugin.enrich!(retried)
    expect(calls).toHaveLength(1)
    expect(retried.event.signals).toEqual({ fault: { value: 'upstream', confidence: 0.9 } })
  })
})

describe('createSignals cache expiry', () => {
  it('asks again once cacheTtlMs has passed', async () => {
    vi.useFakeTimers()
    const cached = defineSignal({
      name: 'fault',
      when: e => (e.status ?? 0) >= 400,
      ask: 'Who is responsible for this failure?',
      choice: { upstream: 'A dependency failed', app: 'Our bug', client: 'Bad input' },
      cacheKey: e => String(e.path),
    })
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({ signals: [cached], evaluate, cacheTtlMs: 60_000 })

    await plugin.enrich!(enrichCtx({ status: 502, path: '/api/pay' }))
    vi.advanceTimersByTime(59_999)
    await plugin.enrich!(enrichCtx({ status: 502, path: '/api/pay' }))
    expect(calls).toHaveLength(1)

    vi.advanceTimersByTime(1)
    await plugin.enrich!(enrichCtx({ status: 502, path: '/api/pay' }))
    expect(calls).toHaveLength(2)
    expect(plugin.stats()).toMatchObject({ calls: 2, cached: 1 })
  })
})

describe('createSignals keep', () => {
  it('asks the enrich signals due on a kept event in the same call', async () => {
    const outcome = defineSignal({
      name: 'outcome',
      when: e => e.path === '/api/checkout',
      ask: 'How did the checkout end?',
      choice: { paid: 'Order paid', abandoned: 'Customer left', failed: 'Payment failed' },
    })
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({ signals: [fault, silentFailure, outcome], evaluate })

    await plugin.keep!(keepCtx({ status: 200, path: '/api/checkout', method: 'POST' }))
    const ctx = enrichCtx({ status: 200, path: '/api/checkout', method: 'POST' })
    await plugin.enrich!(ctx)

    expect(calls).toHaveLength(1)
    expect(Object.keys(calls[0]!.questions)).toEqual(['silent-failure', 'outcome'])
    expect(ctx.event.signals).toEqual({
      'silent-failure': { value: true, confidence: 0.94, kept: true },
      'outcome': { value: 'paid', confidence: 0.9 },
    })
    expect(outcome.read(ctx.event)?.value).toBe('paid')
  })

  it('sees path and method from the sampling context when the request context lacks them', async () => {
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({ signals: [silentFailure], evaluate })
    const tail: TailSamplingContext = { status: 200, path: '/api/checkout', method: 'POST', duration: 12, context: { requestId: 'req-1' }, shouldKeep: false }
    await plugin.keep!(tail)
    expect(calls).toHaveLength(1)
    expect(tail.shouldKeep).toBe(true)
  })

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
    // Two events a minute against one call a minute samples at 0.5: draw low so the call is made.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { evaluate, calls } = fakeEvaluate(yes)
    const plugin = createSignals({ signals: [fault], evaluate, budget: { perMinute: 1, keepShare: 0 } })

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

  it('opens the breaker after three failed calls in a row and closes it after the cooldown', async () => {
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

    for (const path of ['/a', '/b', '/c']) {
      const failed = enrichCtx({ status: 500, path })
      await plugin.enrich!(failed)
      expect(failed.event.signals).toBeUndefined()
    }
    expect(plugin.stats()).toMatchObject({ errors: 3, skipped: 0 })

    fail = false
    await plugin.enrich!(enrichCtx({ status: 500, path: '/d' }))
    expect(calls).toHaveLength(0)
    expect(plugin.stats()).toMatchObject({ skipped: 1 })

    vi.advanceTimersByTime(30_000)
    const ok = enrichCtx({ status: 500, path: '/e' })
    await plugin.enrich!(ok)
    expect(calls).toHaveLength(1)
    expect(ok.event.signals).toEqual({ fault: { value: 'upstream', confidence: 0.9 } })
  })

  it('still promotes when a question that rode along on the keep call is refused', async () => {
    const asked: string[][] = []
    const plugin = createSignals({
      signals: [silentFailure, defineSignal({ name: 'topic', when: e => e.status === 200, ask: 'What was bought?', choice: { book: 'A book', other: 'Anything else' } })],
      evaluate: (request) => {
        asked.push(Object.keys(request.questions))
        if ('topic' in request.questions) return Promise.reject(new Experimental_DecisionRefusalError({ questionIds: ['topic'], provider: 'test', modelId: 'test' }))
        return Promise.resolve({ answers: { 'silent-failure': { type: 'boolean', probability: 0.95 } }, modelId: 'test' })
      },
    })
    const tail = keepCtx({ status: 200, path: '/api/checkout', method: 'POST' })
    await plugin.keep!(tail)
    expect(asked).toEqual([['silent-failure', 'topic'], ['silent-failure']])
    expect(tail.shouldKeep).toBe(true)
    expect(plugin.stats()).toMatchObject({ refused: 1, calls: 1, errors: 0 })
  })

  it('records no verdict on a refusal and leaves the breaker as it was', async () => {
    const { evaluate, calls } = fakeEvaluate(yes)
    let refuse = true
    const plugin = createSignals({
      signals: [fault],
      evaluate: (request) => {
        if (refuse) return Promise.reject(new Experimental_DecisionRefusalError({ questionIds: ['fault'], provider: 'test', modelId: 'test' }))
        return evaluate(request)
      },
    })

    const refused = enrichCtx({ status: 500, path: '/a' })
    await plugin.enrich!(refused)
    expect(refused.event.signals).toBeUndefined()

    refuse = false
    const next = enrichCtx({ status: 500, path: '/b' })
    await plugin.enrich!(next)
    expect(calls).toHaveLength(1)
    expect(next.event.signals).toEqual({ fault: { value: 'upstream', confidence: 0.9 } })
    expect(plugin.stats()).toMatchObject({ refused: 1, errors: 0, skipped: 0 })
  })

  it('does not close an open breaker on a refusal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let outcome: 'fail' | 'refuse' = 'fail'
    let attempts = 0
    const plugin = createSignals({
      signals: [fault],
      evaluate: () => {
        attempts++
        if (outcome === 'refuse') return Promise.reject(new Experimental_DecisionRefusalError({ questionIds: ['fault'], provider: 'test', modelId: 'test' }))
        return Promise.reject(new Error('503'))
      },
    })

    const failing = ['/a', '/b', '/c'].map(path => plugin.enrich!(enrichCtx({ status: 500, path })))
    outcome = 'refuse'
    const refused = plugin.enrich!(enrichCtx({ status: 500, path: '/d' }))
    await Promise.all([...failing, refused])
    await plugin.enrich!(enrichCtx({ status: 500, path: '/e' }))

    expect(attempts).toBe(4)
    expect(plugin.stats()).toMatchObject({ errors: 3, refused: 1, skipped: 1 })
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

describe('under a spike', () => {
  it('still judges a keep signal after an error storm spent the enrich budget', async () => {
    const plugin = createSignals({ signals: [fault, silentFailure], budget: { perMinute: 12 }, evaluate: fakeEvaluate(yes).evaluate })
    for (let i = 0; i < 20; i++) await plugin.enrich!(enrichCtx({ status: 503, path: `/api/pay/${i}` }))
    const tail = keepCtx({ status: 200, path: '/api/checkout', method: 'POST' })
    await plugin.keep!(tail)
    expect(tail.shouldKeep).toBe(true)
  })

  it('skips calls past maxConcurrent instead of queueing them', async () => {
    const release: Array<() => void> = []
    const { evaluate } = fakeEvaluate(yes)
    const plugin = createSignals({
      signals: [fault],
      budget: { maxConcurrent: 2 },
      evaluate: request => new Promise(resolve => release.push(() => resolve(evaluate(request)))),
    })
    const events = Array.from({ length: 5 }, (_, i) => enrichCtx({ status: 500, path: `/api/${i}` }))
    const running = events.map(ctx => plugin.enrich!(ctx))
    expect(release).toHaveLength(2)
    release.forEach(r => r())
    await Promise.all(running)
    expect(plugin.stats()).toMatchObject({ calls: 2, skipped: 3 })
    expect(events.filter(ctx => ctx.event.signals)).toHaveLength(2)
  })

  it('does not build the state of an event the budget skips', async () => {
    const state = vi.fn((event: Record<string, unknown>) => ({ path: event.path }))
    const plugin = createSignals({ signals: [fault], budget: { perMinute: 6, keepShare: 0 }, state, evaluate: fakeEvaluate(yes).evaluate })
    for (let i = 0; i < 3; i++) await plugin.enrich!(enrichCtx({ status: 500, path: `/api/${i}` }))
    expect(state).toHaveBeenCalledTimes(1)
    expect(plugin.stats()).toMatchObject({ calls: 1, skipped: 2 })
  })

  it('writes the share of skipped events a verdict stands for during a spike, and none outside one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const plugin = createSignals({ signals: [fault], budget: { perMinute: 6, keepShare: 0 }, evaluate: fakeEvaluate(yes).evaluate })
    const calm = enrichCtx({ status: 500, path: '/api/0' })
    await plugin.enrich!(calm)
    for (let i = 1; i < 5; i++) await plugin.enrich!(enrichCtx({ status: 500, path: `/api/${i}` }))
    vi.advanceTimersByTime(10_000)
    const spiked = enrichCtx({ status: 500, path: '/api/5' })
    await plugin.enrich!(spiked)
    expect(fault.read(calm.event)).not.toHaveProperty('rate')
    expect(fault.read(spiked.event)?.rate).toBe(0.2)
  })
})
