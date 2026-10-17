import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Cause, Effect, Layer, Logger, References } from 'effect'
import { initLogger } from '../../src/logger'
import { createDrainPipeline } from '../../src/pipeline'
import type { DrainContext } from '../../src/types'
import { initLoggerLayer, loggerLayer, withLogger } from '../../src/effect/index'
import { createPipelineSpies, waitForDrainCalls } from '../helpers/framework'
import { defined, getDrainCallArg } from '../helpers/defined'

async function loggedEvent(program: Effect.Effect<void>) {
  const { drain } = createPipelineSpies()
  await Effect.runPromise(program.pipe(withLogger('job', { drain }), Effect.provide(loggerLayer())))
  await waitForDrainCalls(drain)
  return getDrainCallArg(defined(drain.mock.calls[0], 'drain call')).event
}

describe('evlog/effect loggerLayer', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'effect-test' }, pretty: false })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records Effect log entries on the wide event with their level', async () => {
    const event = await loggedEvent(Effect.gen(function* () {
      yield* Effect.logInfo('loading cart')
      yield* Effect.logWarning('cart is stale')
      yield* Effect.logDebug('cache miss')
    }).pipe(Effect.provideService(References.MinimumLogLevel, 'Debug')))

    expect(event.level).toBe('warn')
    expect(event.requestLogs).toMatchObject([
      { level: 'info', message: 'loading cart' },
      { level: 'warn', message: 'cart is stale' },
      { level: 'debug', message: 'cache miss' },
    ])
  })

  it('records an Error-level message as the error', async () => {
    const event = await loggedEvent(Effect.logError('payment failed'))

    expect(event.level).toBe('error')
    expect(event.error).toMatchObject({ message: 'payment failed' })
  })

  it('records the error of a logged cause', async () => {
    const event = await loggedEvent(Effect.logError('charge failed', Cause.fail(new Error('card declined'))))

    expect(event.error).toMatchObject({ message: 'card declined' })
  })

  it('records a Fatal-level entry as fatal', async () => {
    const event = await loggedEvent(Effect.logFatal('ledger corrupted'))

    expect(event.level).toBe('fatal')
  })

  it('formats printf-style messages', async () => {
    const event = await loggedEvent(Effect.logInfo('loaded %d items', 3))

    expect(event.requestLogs).toMatchObject([{ message: 'loaded 3 items' }])
  })

  it('merges log annotations into the wide event', async () => {
    const event = await loggedEvent(Effect.logInfo('x').pipe(Effect.annotateLogs({ provider: 'stripe' })))

    expect(event.provider).toBe('stripe')
  })

  it('hands entries outside a unit of work to the loggers it replaced', async () => {
    const received: unknown[] = []
    const custom = Logger.make(({ message }) => {
      received.push(message)
    })
    const { drain } = createPipelineSpies()

    await Effect.runPromise(Effect.gen(function* () {
      yield* Effect.logInfo('outside')
      yield* Effect.logInfo('inside').pipe(withLogger('job', { drain }))
    }).pipe(Effect.provide(Layer.provide(loggerLayer(), Logger.layer([custom])))))

    expect(received).toEqual([['outside']])
  })
})

describe('evlog/effect initLoggerLayer', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    initLogger({ env: { service: 'effect-test' }, pretty: false })
    vi.restoreAllMocks()
  })

  it('flushes a pipeline drain when the scope closes', async () => {
    const send = vi.fn<(batch: DrainContext[]) => void>()
    const drain = createDrainPipeline<DrainContext>({ batch: { intervalMs: 60_000 } })(send)

    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      yield* Layer.build(initLoggerLayer({ pretty: false, drain }))
      yield* Effect.void.pipe(withLogger('job'))
      yield* Effect.sync(() => expect(send).not.toHaveBeenCalled())
    })))

    expect(send).toHaveBeenCalledTimes(1)
    expect(defined(send.mock.calls[0], 'send call')[0]).toMatchObject([{ event: { action: 'job' } }])
  })

  it('closes the scope when the flush rejects, and reports the failure', async () => {
    const failure = new Error('endpoint down')
    const drain = Object.assign(vi.fn(), { flush: () => Promise.reject(failure) })

    await Effect.runPromise(Effect.scoped(Layer.build(initLoggerLayer({ pretty: false, drain }))))

    expect(console.error).toHaveBeenCalledWith('[evlog] drain flush failed:', failure)
  })

  it('applies the config with a drain that cannot flush', async () => {
    const { drain } = createPipelineSpies()

    await Effect.runPromise(Effect.void.pipe(
      withLogger('job'),
      Effect.provide(initLoggerLayer({ env: { service: 'billing-worker' }, pretty: false, drain })),
    ))
    await waitForDrainCalls(drain)

    expect(getDrainCallArg(defined(drain.mock.calls[0], 'drain call')).event.service).toBe('billing-worker')
  })
})
