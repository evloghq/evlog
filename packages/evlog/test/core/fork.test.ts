import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { DrainContext, RequestLogger, WideEvent } from '../../src/types'
import { createRequestLogger, initLogger } from '../../src/logger'
import { createDrainPipeline } from '../../src/pipeline'
import type { ForkLifecycle } from '../../src/shared/fork'
import { attachForkToLogger, forkBackgroundLogger } from '../../src/shared/fork'
import type { MiddlewareLoggerOptions } from '../../src/shared/middleware'
import { createMiddlewareLogger } from '../../src/shared/middleware'
import { defined } from '../helpers/defined'
import { flushMicrotasks, withFakeTimers } from '../helpers/timers'

function createGate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

describe('forkBackgroundLogger', () => {
  const storage = new AsyncLocalStorage<RequestLogger>()

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    initLogger({ pretty: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when parent has no requestId', () => {
    const parent = createRequestLogger({
      method: 'GET',
      path: '/a',
    })

    expect(() =>
      forkBackgroundLogger({
        storage,
        parent,
        middlewareOptions: {
          method: 'GET',
          path: '/a',
        },
        label: 'op',
        fn: () => {},
      }),
    ).toThrow(/requestId/)
  })

  it('emits child wide event with operation and _parentRequestId', async () => {
    const drained: unknown[] = []
    initLogger({
      pretty: false,
      drain: ({ event }) => {
        drained.push(event)
      },
    })

    const parent = createRequestLogger({
      method: 'GET',
      path: '/checkout',
      requestId: 'parent-req-id',
    })

    attachForkToLogger(storage, parent, {
      method: 'GET',
      path: '/checkout',
      requestId: 'parent-req-id',
    })

    storage.run(parent, () => {
      parent.fork!('bg_task', () => {
        const log = storage.getStore()!
        log.set({ step: 'done' })
      })
    })

    parent.emit()

    await vi.waitFor(() => {
      expect(drained.length).toBeGreaterThanOrEqual(2)
    })

    const childEvents = drained.filter(
      (e: unknown) => typeof e === 'object' && e !== null && (e as Record<string, unknown>).operation === 'bg_task',
    )
    expect(childEvents.length).toBeGreaterThanOrEqual(1)
    expect(childEvents[0]).toMatchObject({
      operation: 'bg_task',
      _parentRequestId: 'parent-req-id',
      step: 'done',
    })
  })

  it('does not console.warn on child log.set before child emit', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const parent = createRequestLogger({
      method: 'POST',
      path: '/api',
      requestId: 'p-1',
    })

    attachForkToLogger(storage, parent, {
      method: 'POST',
      path: '/api',
      requestId: 'p-1',
    })

    storage.run(parent, () => {
      parent.fork!('job', () => {
        const log = storage.getStore()!
        log.set({ ok: true })
      })
    })

    parent.emit()

    await vi.waitFor(() => {
      const setWarns = warnSpy.mock.calls.filter(c => String(c[0]).includes('log.set()'))
      expect(setWarns.length).toBe(0)
    })
  })
})

describe('log.fork() lifetime', () => {
  const storage = new AsyncLocalStorage<RequestLogger>()

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    initLogger({ pretty: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function startRequest(options: Partial<MiddlewareLoggerOptions>, lifecycle?: ForkLifecycle) {
    const middlewareOptions = { method: 'POST', path: '/api/orders', requestId: 'req-1', ...options }
    const { logger } = createMiddlewareLogger(middlewareOptions)
    attachForkToLogger(storage, logger, middlewareOptions, lifecycle)
    return defined(logger.fork, 'log.fork')
  }

  it('resolves once the child event has drained', async () => {
    const gate = createGate()
    const written: unknown[] = []
    const fork = startRequest({
      drain: async ({ event }) => {
        await gate.opened
        written.push(event.operation)
      },
    })

    let resolved = false
    const done = fork('orders.cancel', () => {}).then(() => {
      resolved = true
    })
    await flushMicrotasks(10)
    expect(resolved).toBe(false)

    gate.open()
    await done
    expect(written).toEqual(['orders.cancel'])
  })

  it('resolves with the error recorded on the child event when fn throws', async () => {
    const drained: WideEvent[] = []
    const fork = startRequest({
      drain: ({ event }) => {
        drained.push(event)
      },
    })

    await expect(fork('charge', () => {
      throw new Error('card declined')
    })).resolves.toBeUndefined()

    expect(drained).toHaveLength(1)
    expect(drained[0]).toMatchObject({
      operation: 'charge',
      level: 'error',
      error: { message: 'card declined' },
    })
  })

  it('registers the child with waitUntil before fn runs and calls onChildExit after its drain', async () => {
    const gate = createGate()
    const order: string[] = []
    const registered: Array<Promise<unknown>> = []
    const fork = startRequest(
      {
        drain: async () => {
          await gate.opened
          order.push('drain')
        },
        waitUntil: (promise) => {
          registered.push(promise)
        },
      },
      { onChildExit: () => order.push('onChildExit') },
    )

    const done = fork('orders.cancel', () => {
      order.push('fn')
    })
    expect(registered).toHaveLength(1)
    expect(order).toEqual([])

    gate.open()
    await Promise.all([done, defined(registered[0], 'registered lifetime')])
    expect(order).toEqual(['fn', 'drain', 'onChildExit'])
  })

  it('logs a failure after the child has emitted instead of recording it on the child', async () => {
    const drain = vi.fn()
    const fork = startRequest({ drain })
    const outputError = new Error('stdout closed')
    vi.mocked(console.info).mockImplementationOnce(() => {
      throw outputError
    })

    await expect(fork('orders.cancel', () => {})).resolves.toBeUndefined()

    expect(console.error).toHaveBeenCalledWith('[evlog] log.fork() failed to emit the child event:', outputError)
    expect(drain).not.toHaveBeenCalled()
  })

  it('keeps waitUntil open until a pipeline drain delivers the child event, without making the fork wait for it', async () => {
    await withFakeTimers(async () => {
      const send = vi.fn<(batch: DrainContext[]) => Promise<void>>().mockResolvedValue(undefined)
      const registered: Array<Promise<unknown>> = []
      const fork = startRequest({
        drain: createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 1000 } })(send),
        waitUntil: (promise) => {
          registered.push(promise)
        },
      })

      await fork('enqueue', () => {})
      expect(send).not.toHaveBeenCalled()

      let delivered = false
      void defined(registered[0], 'registered lifetime').then(() => {
        delivered = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(delivered).toBe(false)

      await vi.advanceTimersByTimeAsync(1000)
      expect(delivered).toBe(true)
      expect(send).toHaveBeenCalledOnce()
      expect(send.mock.calls[0]?.[0][0]?.event).toMatchObject({ operation: 'enqueue' })
      expect(registered).toHaveLength(1)
    })
  })
})
