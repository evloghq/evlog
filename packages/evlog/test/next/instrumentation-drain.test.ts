import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrainContext } from '../../src/types'
import { createDrainPipeline } from '../../src/pipeline'
import { defined } from '../helpers/defined'
import { flushMicrotasks, withFakeTimers } from '../helpers/timers'

const afterState = vi.hoisted(() => ({
  mode: 'collect' as 'collect' | 'throw' | 'missing',
  callbacks: [] as Array<() => unknown>,
  calls: 0,
}))

vi.mock('next/server', () => ({
  get after() {
    if (afterState.mode === 'missing') {
      return undefined
    }
    return (task: () => unknown): void => {
      afterState.calls++
      if (afterState.mode === 'throw') {
        throw new Error('`after` was called outside a request scope')
      }
      afterState.callbacks.push(task)
    }
  },
}))

describe('createInstrumentation global drain lifecycle', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    afterState.mode = 'collect'
    afterState.callbacks = []
    afterState.calls = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function loadModule() {
    vi.resetModules()
    return import('../../src/next/instrumentation-create')
  }

  async function registerWithDrain(drain: (ctx: DrainContext) => void | Promise<void>) {
    const { createInstrumentation } = await loadModule()
    const instrumentation = createInstrumentation({
      service: 'test',
      silent: true,
      drain,
    })
    await instrumentation.register()
    const { log } = await import('../../src/logger')
    return log
  }

  it('defers the global drain through Next after() instead of starting it in the emitting context', async () => {
    const drain = vi.fn()
    const log = await registerWithDrain(drain)

    log.info({ message: 'rendered during prerender' })

    expect(drain).not.toHaveBeenCalled()
    expect(afterState.calls).toBe(1)

    for (const callback of afterState.callbacks.splice(0)) {
      await callback()
    }
    await vi.waitFor(() => {
      expect(drain).toHaveBeenCalledTimes(1)
    })
    expect(drain.mock.calls[0]?.[0]?.event.message).toBe('rendered during prerender')
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('keeps the after callback pending until the async drain completes', async () => {
    let completeSend = () => {}
    const send = new Promise<void>((resolve) => {
      completeSend = resolve
    })
    const drain = vi.fn(() => send)
    const log = await registerWithDrain(drain)

    log.info({ message: 'async delivery' })
    expect(drain).not.toHaveBeenCalled()

    const callback = defined(afterState.callbacks.shift())
    let completed = false
    const completion = Promise.resolve(callback()).then(() => {
      completed = true
    })
    await flushMicrotasks(10)
    const completedBeforeSend = completed
    completeSend()
    await completion

    expect(completedBeforeSend).toBe(false)
    expect(completed).toBe(true)
    expect(drain).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('waits for buffered batches and their retries before completing after work', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('retry delivery'))
      .mockResolvedValue(undefined)
    const drain = createDrainPipeline<DrainContext>({
      batch: { size: 10, intervalMs: 1000 },
      retry: { initialDelayMs: 100, backoff: 'fixed' },
    })(send)
    const log = await registerWithDrain(drain)

    await withFakeTimers(async () => {
      log.info({ message: 'buffered delivery' })
      expect(drain.pending).toBe(0)

      let completed = false
      const callback = defined(afterState.callbacks.shift())
      const completion = Promise.resolve(callback()).then(() => {
        completed = true
      })
      await flushMicrotasks(10)
      const completedBeforeFlush = completed
      expect(send).not.toHaveBeenCalled()
      expect(drain.pending).toBe(1)

      await vi.advanceTimersByTimeAsync(1000)
      const completedBeforeRetry = completed
      expect(send).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(100)
      await completion

      expect(completedBeforeFlush).toBe(false)
      expect(completedBeforeRetry).toBe(false)
      expect(send).toHaveBeenCalledTimes(2)
      expect(send).toHaveBeenLastCalledWith([expect.objectContaining({ event: expect.objectContaining({ message: 'buffered delivery' }) }),])
      expect(completed).toBe(true)
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })
  })

  it.each(['collect', 'throw', 'missing'] as const)(
    'reports a synchronous drain failure once when after is %s', async (mode) => {
      afterState.mode = mode
      const error = new Error('sync delivery failed')
      const drain = vi.fn(() => {
        throw error
      })
      const log = await registerWithDrain(drain)

      expect(() => log.info({ message: 'failed delivery' })).not.toThrow()
      for (const callback of afterState.callbacks.splice(0)) await callback()
      await flushMicrotasks(10)

      expect(drain).toHaveBeenCalledTimes(1)
      expect(consoleErrorSpy).toHaveBeenCalledExactlyOnceWith('[evlog] drain failed:', error)
    },
  )

  it.each(['collect', 'throw', 'missing'] as const)(
    'reports an async drain rejection once when after is %s', async (mode) => {
      afterState.mode = mode
      const error = new Error('async delivery failed')
      const drain = vi.fn().mockRejectedValue(error)
      const log = await registerWithDrain(drain)

      log.info({ message: 'failed delivery' })
      for (const callback of afterState.callbacks.splice(0)) await callback()
      await flushMicrotasks(10)

      expect(drain).toHaveBeenCalledTimes(1)
      expect(consoleErrorSpy).toHaveBeenCalledExactlyOnceWith('[evlog] drain failed:', error)
    },
  )

  it('still delivers the event when after() throws outside a request scope', async () => {
    afterState.mode = 'throw'
    const drain = vi.fn()
    const log = await registerWithDrain(drain)

    log.info({ message: 'boot log' })

    await vi.waitFor(() => {
      expect(drain).toHaveBeenCalledTimes(1)
    })
    expect(drain.mock.calls[0]?.[0]?.event.message).toBe('boot log')
  })

  it('still delivers the event when after() is unavailable', async () => {
    afterState.mode = 'missing'
    const drain = vi.fn()
    const log = await registerWithDrain(drain)

    log.info({ message: 'legacy next' })

    await vi.waitFor(() => {
      expect(drain).toHaveBeenCalledTimes(1)
    })
    expect(drain.mock.calls[0]?.[0]?.event.message).toBe('legacy next')
  })
})
