import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Effect } from 'effect'
import { initLogger } from '../../src/logger'
import {
  EvlogLogger,
  WaitUntil,
  set,
  useLogger,
  withLogger,
} from '../../src/effect/index'
import { createPipelineSpies, findEventViaDrain, waitForDrainCalls } from '../helpers/framework'
import { defined, getDrainCallArg } from '../helpers/defined'

function drainedEvent(drain: ReturnType<typeof createPipelineSpies>['drain'], index = 0) {
  return getDrainCallArg(defined(drain.mock.calls[index], `drain call ${index}`)).event
}

describe('evlog/effect withLogger', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'effect-test' }, pretty: false })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('emits one event per unit with its action, fields and trace ids', async () => {
    const { drain } = createPipelineSpies()

    await Effect.runPromise(Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.set({ users: { migrated: 120 } })
      yield* set({ batch: 4 })
    }).pipe(withLogger('user-migration', { drain, fields: { job: { id: 'j_1' } } })))
    await waitForDrainCalls(drain)

    expect(drain).toHaveBeenCalledTimes(1)
    const event = drainedEvent(drain)
    expect(event).toMatchObject({
      action: 'user-migration',
      level: 'info',
      job: { id: 'j_1' },
      users: { migrated: 120 },
      batch: 4,
    })
    expect(event.traceId).toMatch(/^[\da-f]{32}$/)
    expect(event.spanId).toMatch(/^[\da-f]{16}$/)
    expect(event.method).toBeUndefined()
    expect(event.path).toBeUndefined()
  })

  it('types the logger with your own fields', () => {
    interface CheckoutFields {
      cart: { items: number }
    }
    const program = Effect.gen(function* () {
      const log = yield* useLogger<CheckoutFields>()
      log.set({ cart: { items: 3 } })
      // @ts-expect-error `items` is a number
      log.set({ cart: { items: 'three' } })
    })
    expectTypeOf(program).toEqualTypeOf<Effect.Effect<void, never, EvlogLogger>>()
    expectTypeOf(program.pipe(withLogger('checkout'))).toEqualTypeOf<Effect.Effect<void>>()
  })

  it('makes set a no-op outside a unit of work', async () => {
    await expect(Effect.runPromise(set({ ignored: true }))).resolves.toBeUndefined()
  })

  it('drops a discarded unit that succeeds', async () => {
    const { drain } = createPipelineSpies()

    await Effect.runPromise(Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.set({ recipients: 0 })
      log.discard()
    }).pipe(withLogger('empty-digest', { drain })))

    expect(drain).not.toHaveBeenCalled()
  })

  it('emits a discarded unit when it fails', async () => {
    const { drain } = createPipelineSpies()

    await Effect.runPromiseExit(Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.discard()
      yield* Effect.fail(new Error('mailer unavailable'))
    }).pipe(withLogger('empty-digest', { drain })))
    await waitForDrainCalls(drain)

    expect(drainedEvent(drain)).toMatchObject({
      action: 'empty-digest',
      level: 'error',
      error: { message: 'mailer unavailable' },
    })
  })

  it('keeps a discarded unit that records an error without failing', async () => {
    const { drain } = createPipelineSpies()

    await Effect.runPromise(Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.discard()
      log.error(new Error('partial send'))
    }).pipe(withLogger('digest', { drain })))
    await waitForDrainCalls(drain)

    expect(drainedEvent(drain)).toMatchObject({ action: 'digest', level: 'error' })
  })

  it('drops a discarded unit that is interrupted', async () => {
    const { drain } = createPipelineSpies()

    await Effect.runPromiseExit(Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.discard()
      yield* Effect.interrupt
    }).pipe(withLogger('interrupted-digest', { drain })))

    expect(drain).not.toHaveBeenCalled()
  })

  it('skips keep hooks for a discarded unit', async () => {
    const { drain } = createPipelineSpies()
    const keep = vi.fn()
    const pluginKeep = vi.fn()

    await Effect.runPromise(Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.discard()
    }).pipe(withLogger('empty-digest', { drain, keep, plugins: [{ name: 'signals', keep: pluginKeep }] })))

    expect(keep).not.toHaveBeenCalled()
    expect(pluginKeep).not.toHaveBeenCalled()
    expect(drain).not.toHaveBeenCalled()
  })

  it('emits nothing from a successful onError unit', async () => {
    const { drain } = createPipelineSpies()

    await Effect.runPromise(Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.set({ sessions: { expired: 0 } })
    }).pipe(withLogger('expire-sessions', { drain, emit: 'onError' })))

    expect(drain).not.toHaveBeenCalled()
  })

  it('emits nothing from an interrupted onError unit', async () => {
    const { drain } = createPipelineSpies()

    await Effect.runPromiseExit(Effect.interrupt.pipe(
      withLogger('expire-sessions', { drain, emit: 'onError' }),
    ))

    expect(drain).not.toHaveBeenCalled()
  })

  it('emits an onError unit that records an error and succeeds', async () => {
    const { drain } = createPipelineSpies()

    await Effect.runPromise(Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.error(new Error('3 of 10 sessions failed to delete'))
    }).pipe(withLogger('expire-sessions', { drain, emit: 'onError' })))
    await waitForDrainCalls(drain)

    expect(drainedEvent(drain)).toMatchObject({
      action: 'expire-sessions',
      level: 'error',
      error: { message: '3 of 10 sessions failed to delete' },
    })
  })

  it('keeps a failing onError unit even when head sampling would drop it', async () => {
    const { drain } = createPipelineSpies()
    initLogger({ env: { service: 'effect-test' }, pretty: false, sampling: { rates: { error: 0 } } })

    await Effect.runPromiseExit(Effect.fail(new Error('delete failed')).pipe(
      withLogger('expire-sessions', { drain, emit: 'onError' }),
    ))
    await waitForDrainCalls(drain)

    expect(drainedEvent(drain)).toMatchObject({ action: 'expire-sessions', level: 'error' })
  })

  it('nests units in the same trace', async () => {
    const { drain } = createPipelineSpies()

    await Effect.runPromise(
      Effect.void.pipe(
        withLogger('child', { drain }),
        withLogger('parent', { drain }),
      ),
    )
    await waitForDrainCalls(drain, 2)

    const child = defined(findEventViaDrain(drain, e => e.action === 'child'), 'child')
    const parent = defined(findEventViaDrain(drain, e => e.action === 'parent'), 'parent')
    expect(child.traceId).toBe(parent.traceId)
    expect(child.parentSpanId).toBe(parent.spanId)
  })

  it('continues the trace of a traceparent it is given', async () => {
    const { drain } = createPipelineSpies()
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'

    await Effect.runPromise(Effect.void.pipe(withLogger('alarm', {
      drain,
      traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
    })))
    await waitForDrainCalls(drain)

    expect(drainedEvent(drain)).toMatchObject({ traceId, parentSpanId: '00f067aa0ba902b7' })
  })

  it('awaits the drain without waitUntil, as a Durable Object alarm needs', async () => {
    const order: string[] = []
    const drain = vi.fn(async () => {
      await Promise.resolve()
      order.push('drained')
    })

    await Effect.runPromise(Effect.void.pipe(withLogger('alarm', { drain })))
    order.push('settled')

    expect(order).toEqual(['drained', 'settled'])
  })

  it('hands the drain to waitUntil when one is provided', async () => {
    let releaseDrain!: () => void
    const drain = vi.fn(() => new Promise<void>((resolve) => {
      releaseDrain = resolve
    }))
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>()

    await Effect.runPromise(Effect.void.pipe(
      withLogger('fetch', { drain }),
      Effect.provideService(WaitUntil, waitUntil),
    ))

    expect(drain).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalled()
    releaseDrain()
    await Promise.all(waitUntil.mock.calls.map(([promise]) => promise))
  })

  describe('tail sampling', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
    })

    it('keeps every error and every slow unit when info is sampled out', async () => {
      const { drain } = createPipelineSpies()
      initLogger({
        env: { service: 'effect-test' },
        pretty: false,
        sampling: { rates: { info: 0 }, keep: [{ duration: 1000 }] },
        drain,
      })

      await Effect.runPromise(Effect.void.pipe(withLogger('fast')))
      await Effect.runPromiseExit(Effect.fail(new Error('boom')).pipe(withLogger('failing')))
      await Effect.runPromise(Effect.sync(() => vi.setSystemTime(Date.now() + 1500)).pipe(withLogger('slow')))
      await waitForDrainCalls(drain, 2)

      const actions = drain.mock.calls.map(call => getDrainCallArg(call).event.action)
      expect(actions).toEqual(['failing', 'slow'])
    })

    it('lets the keep callback force-keep a unit', async () => {
      const { drain } = createPipelineSpies()
      initLogger({ env: { service: 'effect-test' }, pretty: false, sampling: { rates: { info: 0 } } })

      await Effect.runPromise(Effect.gen(function* () {
        const log = yield* EvlogLogger
        log.set({ plan: 'enterprise' })
      }).pipe(withLogger('upgrade', {
        drain,
        keep: (ctx) => {
          if (ctx.context.plan === 'enterprise') ctx.shouldKeep = true
        },
      })))
      await waitForDrainCalls(drain)

      expect(drainedEvent(drain).plan).toBe('enterprise')
    })
  })

  describe('redaction', () => {
    it('masks PII and secrets set from Effect code', async () => {
      const { drain } = createPipelineSpies()
      initLogger({ env: { service: 'effect-test' }, pretty: false, redact: true })

      await Effect.runPromise(set({
        user: { email: 'jane@example.com' },
        apiToken: 'sk_live_abc123',
      }).pipe(withLogger('signup', { drain })))
      await waitForDrainCalls(drain)

      const event = drainedEvent(drain)
      expect(JSON.stringify(event)).not.toContain('jane@example.com')
      expect(event.apiToken).toBe('[REDACTED]')
    })

    it('drops content fields configured as redact paths', async () => {
      const { drain } = createPipelineSpies()
      initLogger({
        env: { service: 'effect-test' },
        pretty: false,
        redact: { paths: ['prompt', '**.content', 'tool.input'] },
      })

      await Effect.runPromise(set({
        prompt: 'summarize my inbox',
        messages: [{ role: 'user', content: 'private message body' }],
        tool: { name: 'search', input: { query: 'tool payload body' } },
      }).pipe(withLogger('turn', { drain })))
      await waitForDrainCalls(drain)

      const event = drainedEvent(drain)
      expect(event.tool).toMatchObject({ name: 'search' })
      expect(JSON.stringify(event)).not.toMatch(/summarize my inbox|private message body|tool payload body/)
    })
  })
})
