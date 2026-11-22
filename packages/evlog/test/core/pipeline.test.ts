import { afterEach, beforeEach, describe, expect, it, vi, onTestFinished } from 'vitest'
import type { DrainContext } from '../../src/types'
import { createDrainPipeline } from '../../src/pipeline'
import { createHyperDXDrain } from '../../src/adapters/hyperdx'
import { createOTLPDrain } from '../../src/adapters/otlp'
import { createPostHogDrain } from '../../src/adapters/posthog'
import { createSazabiDrain } from '../../src/adapters/sazabi'
import { defineDrain, defineHttpDrain } from '../../src/shared/drain'
import { DrainDeliveryError } from '../../src/shared/http'
import { deliverPendingDrains } from '../../src/shared/shutdown'
import { defined } from '../helpers/defined'
import { expectLinearTime } from '../helpers/timers'

function getBatchArg(call: unknown[]): DrainContext[] {
  return defined(call[0], 'batch arg') as DrainContext[]
}

function createTestContext(id: number): DrainContext {
  return {
    event: {
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'info',
      service: 'test',
      environment: 'test',
      id,
    },
  }
}

describe('createDrainPipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Request-end flushes wait on every pipeline in the process: forget the ones earlier tests left holding events.
    ;(globalThis as Record<symbol, { pending?: Set<unknown> } | undefined>)[Symbol.for('evlog.drains.v2')]?.pending?.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('batching by size', () => {
    it('does not flush before batch size is reached', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 3, intervalMs: 60000 } })(drain)

      hook(createTestContext(1))
      hook(createTestContext(2))

      await vi.advanceTimersByTimeAsync(0)
      expect(drain).not.toHaveBeenCalled()

      await hook.flush()
    })

    it('flushes when batch size is reached', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 3, intervalMs: 60000 } })(drain)

      hook(createTestContext(1))
      hook(createTestContext(2))
      hook(createTestContext(3))

      await vi.runAllTimersAsync()

      expect(drain).toHaveBeenCalledTimes(1)
      const batch = getBatchArg(defined(drain.mock.calls[0], 'drain call'))
      expect(batch).toHaveLength(3)
      expect(defined(batch[0], 'batch[0]').event.id).toBe(1)
      expect(defined(batch[1], 'batch[1]').event.id).toBe(2)
      expect(defined(batch[2], 'batch[2]').event.id).toBe(3)
    })

    it('splits into multiple batches', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 3 } })(drain)

      for (let i = 1; i <= 7; i++) hook(createTestContext(i))

      await hook.flush()

      expect(drain).toHaveBeenCalledTimes(3)
      expect(getBatchArg(defined(drain.mock.calls[0], 'drain call 0'))).toHaveLength(3)
      expect(getBatchArg(defined(drain.mock.calls[1], 'drain call 1'))).toHaveLength(3)
      expect(getBatchArg(defined(drain.mock.calls[2], 'drain call 2'))).toHaveLength(1)
    })
  })

  describe('batching by interval', () => {
    it('flushes after interval expires', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 100, intervalMs: 5000 } })(drain)

      hook(createTestContext(1))
      hook(createTestContext(2))

      await vi.advanceTimersByTimeAsync(4999)
      expect(drain).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(drain).toHaveBeenCalledTimes(1)
      expect(getBatchArg(defined(drain.mock.calls[0], 'drain call'))).toHaveLength(2)
    })

    it('resets interval when batch size is reached', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 2, intervalMs: 5000 } })(drain)

      hook(createTestContext(1))
      hook(createTestContext(2))

      // Batch size reached, should flush immediately
      await vi.advanceTimersByTimeAsync(0)
      expect(drain).toHaveBeenCalledTimes(1)

      // Push one more - should start interval timer, not flush immediately
      hook(createTestContext(3))
      await vi.advanceTimersByTimeAsync(0)
      expect(drain).toHaveBeenCalledTimes(1)

      // Wait for interval
      await vi.advanceTimersByTimeAsync(5000)
      expect(drain).toHaveBeenCalledTimes(2)
    })
  })

  describe('retry', () => {
    it('retries on failure with exponential backoff', async () => {
      const drain = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce(undefined)

      const hook = createDrainPipeline({
        batch: { size: 1 },
        retry: { maxAttempts: 3, backoff: 'exponential', initialDelayMs: 100, maxDelayMs: 10000 },
      })(drain)

      hook(createTestContext(1))

      // First attempt (immediate)
      await vi.advanceTimersByTimeAsync(0)
      expect(drain).toHaveBeenCalledTimes(1)

      // Wait for first retry delay (100ms * 2^0 = 100ms)
      await vi.advanceTimersByTimeAsync(100)
      expect(drain).toHaveBeenCalledTimes(2)

      // Wait for second retry delay (100ms * 2^1 = 200ms)
      await vi.advanceTimersByTimeAsync(200)
      expect(drain).toHaveBeenCalledTimes(3)
    })

    it('retries with linear backoff', async () => {
      const drain = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(undefined)

      const hook = createDrainPipeline({
        batch: { size: 1 },
        retry: { maxAttempts: 3, backoff: 'linear', initialDelayMs: 100 },
      })(drain)

      hook(createTestContext(1))

      await vi.advanceTimersByTimeAsync(0)
      expect(drain).toHaveBeenCalledTimes(1)

      // Linear: 100 * 1 = 100ms
      await vi.advanceTimersByTimeAsync(100)
      expect(drain).toHaveBeenCalledTimes(2)

      // Linear: 100 * 2 = 200ms
      await vi.advanceTimersByTimeAsync(200)
      expect(drain).toHaveBeenCalledTimes(3)
    })

    it('retries with fixed backoff', async () => {
      const drain = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(undefined)

      const hook = createDrainPipeline({
        batch: { size: 1 },
        retry: { maxAttempts: 2, backoff: 'fixed', initialDelayMs: 100 },
      })(drain)

      hook(createTestContext(1))

      await vi.advanceTimersByTimeAsync(0)
      expect(drain).toHaveBeenCalledTimes(1)

      // Fixed: always 100ms
      await vi.advanceTimersByTimeAsync(100)
      expect(drain).toHaveBeenCalledTimes(2)
    })

    it('caps retry delay at maxDelayMs', async () => {
      const drain = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(undefined)

      const hook = createDrainPipeline({
        batch: { size: 1 },
        retry: { maxAttempts: 2, backoff: 'exponential', initialDelayMs: 1000, maxDelayMs: 500 },
      })(drain)

      hook(createTestContext(1))

      await vi.advanceTimersByTimeAsync(0)
      expect(drain).toHaveBeenCalledTimes(1)

      // Exponential: 1000 * 2^0 = 1000ms, capped to 500ms
      await vi.advanceTimersByTimeAsync(500)
      expect(drain).toHaveBeenCalledTimes(2)
    })

    it('calls onDropped after all retries exhausted', async () => {
      const drain = vi.fn().mockRejectedValue(new Error('permanent failure'))
      const onDropped = vi.fn()

      const hook = createDrainPipeline({
        batch: { size: 1 },
        retry: { maxAttempts: 2, backoff: 'fixed', initialDelayMs: 50 },
        onDropped,
      })(drain)

      hook(createTestContext(1))

      await vi.runAllTimersAsync()

      expect(drain).toHaveBeenCalledTimes(2)
      expect(onDropped).toHaveBeenCalledTimes(1)
      const droppedCall = defined(onDropped.mock.calls[0], 'onDropped call')
      expect(getBatchArg(droppedCall)).toHaveLength(1)
      expect(droppedCall[1]).toBeInstanceOf(Error)
      expect((defined(droppedCall[1], 'dropped error') as Error).message).toBe('permanent failure')
    })
  })

  describe('buffer overflow', () => {
    it('drops oldest events and calls onDropped when buffer is full', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const onDropped = vi.fn()

      const hook = createDrainPipeline({
        batch: { size: 100, intervalMs: 60000 },
        maxBufferSize: 3,
        onDropped,
      })(drain)

      hook(createTestContext(1))
      hook(createTestContext(2))
      hook(createTestContext(3))
      expect(onDropped).not.toHaveBeenCalled()

      // Buffer full - should drop oldest
      hook(createTestContext(4))
      expect(onDropped).toHaveBeenCalledTimes(1)
      const droppedBatch = getBatchArg(defined(onDropped.mock.calls[0], 'onDropped call'))
      expect(droppedBatch).toHaveLength(1)
      expect(defined(droppedBatch[0], 'dropped batch[0]').event.id).toBe(1)

      expect(hook.pending).toBe(3)

      // Flush and verify the remaining events are 2, 3, 4
      await hook.flush()
      const batch = getBatchArg(defined(drain.mock.calls[0], 'drain call'))
      expect(batch.map(c => c.event.id)).toEqual([2, 3, 4])
    })

    it('puts a paused batch back ahead of the events left after an overflow during its send', async () => {
      const pending: Array<(error: Error) => void> = []
      const drain = vi.fn(() => new Promise<void>((_, reject) => pending.push(reject)))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 1, intervalMs: 600_000 }, maxBufferSize: 2, onDropped })(drain)

      hook(createTestContext(0))
      hook(createTestContext(1))
      hook(createTestContext(2))
      hook(createTestContext(3))
      defined(pending[0], 'send')(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 60_000 }))
      await vi.advanceTimersByTimeAsync(0)

      expect(onDropped.mock.calls.map(call => getBatchArg(call).map(ctx => ctx.event.id))).toEqual([[1], [0]])
      expect(hook.pending).toBe(2)
      await hook.flush()
      expect(onDropped.mock.calls.slice(2).flatMap(call => getBatchArg(call).map(ctx => ctx.event.id))).toEqual([2, 3])
    })
  })

  describe('flush()', () => {
    it('drains all buffered events', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 100 } })(drain)

      hook(createTestContext(1))
      hook(createTestContext(2))
      hook(createTestContext(3))

      await hook.flush()

      expect(drain).toHaveBeenCalledTimes(1)
      expect(getBatchArg(defined(drain.mock.calls[0], 'drain call'))).toHaveLength(3)
      expect(hook.pending).toBe(0)
    })

    it('is safe to call when buffer is empty', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline()(drain)

      await hook.flush()

      expect(drain).not.toHaveBeenCalled()
    })

    it('handles concurrent flush() calls safely', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 100, intervalMs: 60000 } })(drain)

      hook(createTestContext(1))
      hook(createTestContext(2))

      const [r1, r2] = await Promise.all([hook.flush(), hook.flush()])

      expect(r1).toBeUndefined()
      expect(r2).toBeUndefined()
      expect(drain).toHaveBeenCalledTimes(1)
      expect(hook.pending).toBe(0)
    })

    it('resolves a second flush() only after the batch the first one is sending is delivered', async () => {
      let release!: () => void
      const drain = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
        release = resolve
      }))
      const hook = createDrainPipeline({ batch: { size: 100, intervalMs: 60000 } })(drain)
      hook(createTestContext(1))

      const first = hook.flush()
      let secondDone = false
      const second = hook.flush().then(() => {
        secondDone = true
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(drain).toHaveBeenCalledTimes(1)
      expect(secondDone).toBe(false)
      release()
      await Promise.all([first, second])
      expect(secondDone).toBe(true)
    })

    it('flush drains events that arrived during active flush', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 2, intervalMs: 60000 } })(drain)

      // Push 2 events to trigger auto-flush
      hook(createTestContext(1))
      hook(createTestContext(2))

      // Push more while flush may be in progress
      hook(createTestContext(3))

      // Explicit flush should drain everything
      await hook.flush()

      expect(hook.pending).toBe(0)
      const allEvents = drain.mock.calls.flatMap(call => call[0] as DrainContext[])
      expect(allEvents).toHaveLength(3)
    })
  })

  describe('pending', () => {
    it('returns current buffer size', () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 100, intervalMs: 60000 } })(drain)

      expect(hook.pending).toBe(0)
      hook(createTestContext(1))
      expect(hook.pending).toBe(1)
      hook(createTestContext(2))
      expect(hook.pending).toBe(2)
    })

    it('returns 0 after flush', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 100 } })(drain)

      hook(createTestContext(1))
      hook(createTestContext(2))
      expect(hook.pending).toBe(2)

      await hook.flush()
      expect(hook.pending).toBe(0)
    })
  })

  describe('defaults', () => {
    it('uses default options when none provided', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline()(drain)

      hook(createTestContext(1))

      // Default interval is 5000ms
      await vi.advanceTimersByTimeAsync(4999)
      expect(drain).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(drain).toHaveBeenCalledTimes(1)
    })
  })

  describe('input validation', () => {
    it('throws on batch.size <= 0', () => {
      expect(() => createDrainPipeline({ batch: { size: 0 } })).toThrow('batch.size must be a positive finite number')
    })

    it('throws on batch.size = -1', () => {
      expect(() => createDrainPipeline({ batch: { size: -1 } })).toThrow('batch.size must be a positive finite number')
    })

    it('throws on batch.intervalMs <= 0', () => {
      expect(() => createDrainPipeline({ batch: { intervalMs: 0 } })).toThrow('batch.intervalMs must be a positive finite number')
    })

    it('throws on maxBufferSize <= 0', () => {
      expect(() => createDrainPipeline({ maxBufferSize: 0 })).toThrow('maxBufferSize must be a positive finite number')
    })

    it('throws on retry.maxAttempts <= 0', () => {
      expect(() => createDrainPipeline({ retry: { maxAttempts: 0 } })).toThrow('retry.maxAttempts must be a positive finite number')
    })

    it('throws on non-finite batch.size', () => {
      expect(() => createDrainPipeline({ batch: { size: Infinity } })).toThrow('batch.size must be a positive finite number')
    })

    it('throws on NaN batch.size', () => {
      expect(() => createDrainPipeline({ batch: { size: NaN } })).toThrow('batch.size must be a positive finite number')
    })
  })

  describe('adapter raw composition', () => {
    it('uses drain.raw so retries and onDropped observe adapter failures', async () => {
      const send = vi.fn().mockRejectedValue(new Error('ingest down'))
      const adapter = defineDrain<{ ok: boolean }>({
        name: 'unit-test',
        resolve: () => ({ ok: true }),
        send,
      })
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({
        batch: { size: 1, intervalMs: 60000 },
        retry: { maxAttempts: 2, initialDelayMs: 10 },
        onDropped,
      })(adapter)

      hook(createTestContext(1))
      await vi.runAllTimersAsync()

      expect(send).toHaveBeenCalledTimes(2)
      expect(onDropped).toHaveBeenCalledTimes(1)
      const [batch, error] = defined(onDropped.mock.calls[0], 'onDropped call')
      expect(batch).toHaveLength(1)
      expect((error as Error).message).toContain('ingest down')
    })

    it('delivers through drain.raw on success', async () => {
      const send = vi.fn().mockResolvedValue(undefined)
      const adapter = defineDrain<{ ok: boolean }>({
        name: 'unit-test',
        resolve: () => ({ ok: true }),
        send,
      })
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 2, intervalMs: 60000 } })(adapter)

      hook(createTestContext(1))
      hook(createTestContext(2))
      await vi.runAllTimersAsync()

      expect(send).toHaveBeenCalledTimes(1)
      const [events] = defined(send.mock.calls[0], 'send call')
      expect(events).toHaveLength(2)
    })

    it('logs dropped batches when no onDropped is provided', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const drain = vi.fn().mockRejectedValue(new Error('boom'))
      const hook = createDrainPipeline<DrainContext>({
        batch: { size: 1, intervalMs: 60000 },
        retry: { maxAttempts: 1 },
      })(drain)

      hook(createTestContext(1))
      await vi.runAllTimersAsync()

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[evlog/pipeline] Dropped 1 event(s): 1 retries-exhausted.'),
        expect.any(Error),
      )
      errorSpy.mockRestore()
    })
  })

  describe('delivery failures', () => {
    function httpDrain() {
      return defineHttpDrain<{ url: string }>({
        name: 'unit-http',
        resolve: () => ({ url: 'https://ingest.example.com' }),
        encode: (events, config) => ({ url: config.url, headers: {}, body: JSON.stringify(events) }),
      })
    }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('drops a 400 after one request instead of retrying it', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad payload', { status: 400 }))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 1 }, onDropped })(httpDrain())

      hook(createTestContext(1))
      await vi.runAllTimersAsync()

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(onDropped).toHaveBeenCalledTimes(1)
      expect(defined(onDropped.mock.calls[0], 'onDropped call')[1]).toMatchObject({ status: 400, retryable: false })
    })

    it('still retries plain errors thrown by a custom drain', async () => {
      const drain = vi.fn().mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValueOnce(undefined)
      const hook = createDrainPipeline({ batch: { size: 1 }, retry: { initialDelayMs: 10 } })(drain)

      hook(createTestContext(1))
      await vi.runAllTimersAsync()

      expect(drain).toHaveBeenCalledTimes(2)
    })

    it('waits for Retry-After instead of the backoff delay', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 1 }, retry: { initialDelayMs: 1000 }, onDropped })(httpDrain())

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(29_999)
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(onDropped).not.toHaveBeenCalled()
    })

    it('pauses and keeps the batch when Retry-After exceeds maxDelayMs', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('quota', { status: 429, headers: { 'Retry-After': '120' } }))
        .mockResolvedValue(new Response(null, { status: 200 }))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({
        batch: { size: 2, intervalMs: 1000 },
        retry: { maxAttempts: 1 },
        onDropped,
      })(httpDrain())

      hook(createTestContext(1))
      hook(createTestContext(2))
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      hook(createTestContext(3))
      hook(createTestContext(4))
      await vi.advanceTimersByTimeAsync(119_999)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(hook.pending).toBe(4)

      await vi.advanceTimersByTimeAsync(1)
      expect(onDropped).not.toHaveBeenCalled()
      const sent = fetchSpy.mock.calls.slice(1).flatMap(([, init]) => JSON.parse(String(init?.body)))
      expect(sent).toMatchObject([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }])
    })

    it('keeps the longer pause when a concurrent delivery reports a shorter Retry-After', async () => {
      const pending: Array<(error: Error) => void> = []
      const drain = vi.fn(() => new Promise<void>((_, reject) => pending.push(reject)))
      const hook = createDrainPipeline({ batch: { size: 2, intervalMs: 600_000 }, onDropped: vi.fn() })(drain)

      hook(createTestContext(1))
      const flushing = hook.flush()
      hook(createTestContext(2))
      hook(createTestContext(3))
      await vi.advanceTimersByTimeAsync(0)
      expect(drain).toHaveBeenCalledTimes(2)

      defined(pending[1], 'batch send')(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 120_000 }))
      await vi.advanceTimersByTimeAsync(0)
      defined(pending[0], 'flush send')(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 60_000 }))
      await flushing

      await vi.advanceTimersByTimeAsync(61_000)
      hook(createTestContext(4))
      await vi.advanceTimersByTimeAsync(0)
      expect(drain).toHaveBeenCalledTimes(2)
    })

    it('does not retry into a pause another delivery started while it waited', async () => {
      const pending: Array<(error: Error) => void> = []
      const drain = vi.fn(() => new Promise<void>((_, reject) => pending.push(reject)))
      const onDropped = vi.fn()
      const hook = createDrainPipeline({ batch: { size: 2, intervalMs: 600_000 }, retry: { initialDelayMs: 10_000 }, onDropped })(drain)

      hook(createTestContext(1))
      const flushing = hook.flush()
      hook(createTestContext(2))
      hook(createTestContext(3))
      await vi.advanceTimersByTimeAsync(0)

      defined(pending[0], 'flush send')(new Error('socket hang up'))
      await vi.advanceTimersByTimeAsync(0)
      defined(pending[1], 'batch send')(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 120_000 }))
      await vi.advanceTimersByTimeAsync(10_000)
      await flushing

      expect(drain).toHaveBeenCalledTimes(2)
      expect(getBatchArg(defined(onDropped.mock.calls[0], 'onDropped call')).map(c => c.event.id)).toEqual([1])
    })

    it('resumes when the pause ends, not after a longer batch interval', async () => {
      const drain = vi.fn()
        .mockRejectedValueOnce(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 120_000 }))
        .mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 1, intervalMs: 600_000 }, retry: { maxAttempts: 1 } })(drain)

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(120_000)

      expect(drain).toHaveBeenCalledTimes(2)
    })

    it('waits out a Retry-After longer than setTimeout allows without spinning', async () => {
      const drain = vi.fn().mockRejectedValue(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 30 * 24 * 3600_000 }))
      const hook = createDrainPipeline({ batch: { size: 1 } })(drain)

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(0)

      const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms ?? 0)
      expect(Math.max(...delays)).toBe(2_147_483_647)
      expect(drain).toHaveBeenCalledTimes(1)
    })

    it('drops the paused batch on flush() instead of holding shutdown', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('quota', { status: 429, headers: { 'Retry-After': '120' } }))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 1 }, onDropped })(httpDrain())

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(0)
      await hook.flush()

      expect(onDropped).toHaveBeenCalledTimes(1)
      const [batch, error] = defined(onDropped.mock.calls[0], 'onDropped call')
      expect((batch as DrainContext[]).map(c => c.event.id)).toEqual([1])
      expect(error).toMatchObject({ status: 429, retryAfterMs: 120_000 })
      expect(hook.pending).toBe(0)
    })

    it('resumes at the end of a pause that starts while a batch timer is pending', async () => {
      const pending: Array<(error: Error) => void> = []
      const drain = vi.fn()
        .mockImplementationOnce(() => new Promise<void>((_, reject) => pending.push(reject)))
        .mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 10, intervalMs: 600_000 }, onDropped: vi.fn() })(drain)

      hook(createTestContext(1))
      const flushing = hook.flush()
      hook(createTestContext(2))
      defined(pending[0], 'flush send')(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 120_000 }))
      await flushing

      await vi.advanceTimersByTimeAsync(120_000)
      expect(drain).toHaveBeenCalledTimes(2)
    })

    it('reads retryable and retryAfterMs off a DrainDeliveryError from a custom drain', async () => {
      const drain = vi.fn().mockRejectedValue(new DrainDeliveryError('too large', { status: 413, retryable: false }))
      const onDropped = vi.fn()
      const hook = createDrainPipeline({ batch: { size: 1 }, onDropped })(drain)

      hook(createTestContext(1))
      await vi.runAllTimersAsync()

      expect(drain).toHaveBeenCalledTimes(1)
      expect(onDropped).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['hyperdx', () => createHyperDXDrain({ apiKey: 'k' })],
      ['sazabi', () => createSazabiDrain({ endpoint: 'https://intake.sazabi.com/k' })],
      ['posthog logs', () => createPostHogDrain({ apiKey: 'k' })],
    ])('%s makes one request per pipeline attempt against a 503', async (_name, create) => {
      // Adapter config resolves through a dynamic import, which fake timers never settle.
      vi.useRealTimers()
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('down', { status: 503 })))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({
        batch: { size: 10, intervalMs: 60_000 },
        retry: { maxAttempts: 3, initialDelayMs: 1 },
        onDropped,
      })(create())

      hook(createTestContext(1))
      await hook.flush()

      expect(fetchSpy).toHaveBeenCalledTimes(3)
      expect(onDropped).toHaveBeenCalledTimes(1)
    })
  })

  describe('drop reporting', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('passes the reason of every drop to onDropped and counts it in stats()', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('bad', { status: 400 }))
        .mockResolvedValueOnce(new Response('down', { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response('quota', { status: 429, headers: { 'Retry-After': '600' } }))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({
        batch: { size: 1, intervalMs: 60_000 },
        retry: { maxAttempts: 1 },
        maxBufferSize: 1,
        onDropped,
      })(defineHttpDrain<{ url: string }>({
        name: 'unit-http',
        resolve: () => ({ url: 'https://ingest.example.com' }),
        encode: (events, config) => ({ url: config.url, headers: {}, body: JSON.stringify(events) }),
      }))

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(0)
      hook(createTestContext(2))
      await vi.advanceTimersByTimeAsync(0)
      hook(createTestContext(3))
      await vi.advanceTimersByTimeAsync(0)
      hook(createTestContext(4))
      await vi.advanceTimersByTimeAsync(0)
      hook(createTestContext(5))
      hook(createTestContext(6))
      await hook.flush()

      const reasons = onDropped.mock.calls.map(([events, , reason]) => [reason, (events as DrainContext[]).map(c => c.event.id)])
      expect(reasons).toEqual([
        ['rejected', [1]],
        ['retries-exhausted', [2]],
        ['buffer-full', [4]],
        ['buffer-full', [5]],
        ['rate-limited', [6]],
      ])
      expect(hook.stats()).toEqual({
        delivered: 1,
        dropped: { 'buffer-full': 2, 'rejected': 1, 'retries-exhausted': 1, 'rate-limited': 1, 'deferred': 0, 'deadline': 0 },
      })
    })

    it('counts only the records an OTLP collector rejected in a partial success', async () => {
      // Adapter config resolves through a dynamic import, which fake timers never settle.
      vi.useRealTimers()
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
        JSON.stringify({ partialSuccess: { rejectedLogRecords: 2, errorMessage: 'invalid record' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 60_000 }, onDropped })(
        createOTLPDrain({ endpoint: 'http://localhost:4318' }),
      )

      for (let id = 1; id <= 5; id++) hook(createTestContext(id))
      await hook.flush()

      expect(hook.stats()).toEqual({
        delivered: 3,
        dropped: { 'buffer-full': 0, 'rejected': 2, 'retries-exhausted': 0, 'rate-limited': 0, 'deferred': 0, 'deadline': 0 },
      })
      expect(onDropped).toHaveBeenCalledTimes(1)
      const [batch, error, reason] = defined(onDropped.mock.calls[0], 'onDropped call')
      expect((batch as DrainContext[]).map(c => c.event.id)).toEqual([1, 2, 3, 4, 5])
      expect(error).toMatchObject({ rejected: 2 })
      expect(reason).toBe('rejected')
    })

    it('logs buffer-full drops without onDropped, at most once per minute, and the rest on flush()', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 100, intervalMs: 600_000 }, maxBufferSize: 2 })(drain)

      for (let id = 1; id <= 5; id++) hook(createTestContext(id))
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Dropped 1 event(s): 1 buffer-full.')

      await vi.advanceTimersByTimeAsync(60_000)
      hook(createTestContext(6))
      expect(errorSpy).toHaveBeenCalledTimes(2)
      expect(errorSpy.mock.calls[1]?.[0]).toContain('Dropped 3 event(s): 3 buffer-full.')

      hook(createTestContext(7))
      expect(errorSpy).toHaveBeenCalledTimes(2)
      await hook.flush()
      expect(errorSpy).toHaveBeenCalledTimes(3)
      expect(errorSpy.mock.calls[2]?.[0]).toContain('Dropped 1 event(s): 1 buffer-full.')
      expect(hook.stats().dropped['buffer-full']).toBe(5)
    })
  })

  describe('settled()', () => {
    it('resolves immediately when nothing is buffered', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 10, intervalMs: 5000 } })(drain)

      let resolved = false
      void hook.settled().then(() => {
        resolved = true
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(resolved).toBe(true)
      expect(drain).not.toHaveBeenCalled()
    })

    it('resolves once the interval flush delivers buffered events', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 10, intervalMs: 5000 } })(drain)

      hook(createTestContext(1))
      let resolved = false
      void hook.settled().then(() => {
        resolved = true
      })

      await vi.advanceTimersByTimeAsync(4999)
      expect(resolved).toBe(false)
      expect(drain).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(resolved).toBe(true)
      expect(drain).toHaveBeenCalledTimes(1)
    })

    it('resolves after a failing batch is dropped', async () => {
      const drain = vi.fn().mockRejectedValue(new Error('boom'))
      const hook = createDrainPipeline({
        batch: { size: 1, intervalMs: 60000 },
        retry: { maxAttempts: 2, initialDelayMs: 10 },
        onDropped: vi.fn(),
      })(drain)

      hook(createTestContext(1))
      let resolved = false
      void hook.settled().then(() => {
        resolved = true
      })

      await vi.runAllTimersAsync()
      expect(resolved).toBe(true)
      expect(drain).toHaveBeenCalledTimes(2)
    })

    it('stays pending while an explicit flush() delivery is in flight', async () => {
      let resolveDrain!: () => void
      const drain = vi.fn(() => new Promise<void>((resolve) => {
        resolveDrain = resolve
      }))
      const hook = createDrainPipeline({ batch: { size: 10, intervalMs: 60000 } })(drain)

      hook(createTestContext(1))
      const flushPromise = hook.flush()
      await vi.advanceTimersByTimeAsync(0)
      expect(drain).toHaveBeenCalledTimes(1)

      let resolved = false
      void hook.settled().then(() => {
        resolved = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(resolved).toBe(false)

      resolveDrain()
      await flushPromise
      await vi.advanceTimersByTimeAsync(0)
      expect(resolved).toBe(true)
    })

    it('resolves via flush()', async () => {
      const drain = vi.fn().mockResolvedValue(undefined)
      const hook = createDrainPipeline({ batch: { size: 10, intervalMs: 60000 } })(drain)

      hook(createTestContext(1))
      let resolved = false
      void hook.settled().then(() => {
        resolved = true
      })

      await hook.flush()
      await vi.advanceTimersByTimeAsync(0)

      expect(resolved).toBe(true)
      expect(drain).toHaveBeenCalledTimes(1)
    })
  })

  describe('request-end flush', () => {
    it('keeps request-end waits linear in held events while the backend hangs', () => {
      expectLinearTime<number>((events) => {
        (globalThis as Record<symbol, { pending?: Set<unknown> } | undefined>)[Symbol.for('evlog.drains.v2')]?.pending?.clear()
        const hook = createDrainPipeline<DrainContext>({ batch: { size: 1, intervalMs: 5000 }, maxBufferSize: events, onDropped: () => {} })(() => new Promise<void>(() => {}))
        for (let id = 0; id < events; id++) hook(createTestContext(id))
        for (let i = 0; i < events; i++) void deliverPendingDrains()
        for (let id = 0; id < events; id++) hook(createTestContext(events + id))
      }, n => 250 * n, 'request-end waits')
    })

    it('keeps pushes into a full buffer linear in its size while the backend hangs', () => {
      expectLinearTime<number>((events) => {
        (globalThis as Record<symbol, { pending?: Set<unknown> } | undefined>)[Symbol.for('evlog.drains.v2')]?.pending?.clear()
        const hook = createDrainPipeline<DrainContext>({ batch: { size: 1, intervalMs: 5000 }, maxBufferSize: events, onDropped: () => {} })(() => new Promise<void>(() => {}))
        for (let id = 0; id < 2 * events; id++) hook(createTestContext(id))
      }, n => 4_000 * n, 'buffer-full pushes')
    })

    it('resolves every request at 20 events/s with a 300 ms backend, within two round trips of its end', async () => {
      vi.stubEnv('VERCEL', '1')
      onTestFinished(() => vi.unstubAllEnvs())
      const drain = vi.fn((_batch: DrainContext[]) => new Promise<void>(resolve => setTimeout(resolve, 300)))
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 50, intervalMs: 5000 } })(drain)
      const latencies: number[] = []

      for (let id = 1; id <= 60; id++) {
        const endedAt = Date.now()
        hook(createTestContext(id))
        void deliverPendingDrains().then(() => {
          latencies.push(Date.now() - endedAt)
        })
        await vi.advanceTimersByTimeAsync(50)
      }
      await vi.advanceTimersByTimeAsync(600)

      expect(latencies).toHaveLength(60)
      expect(Math.max(...latencies)).toBeLessThanOrEqual(600)
      expect(drain.mock.calls.flatMap(call => getBatchArg(call).map(ctx => ctx.event.id))).toEqual(Array.from({ length: 60 }, (_, i) => i + 1))
      expect(drain.mock.calls.length).toBeLessThan(20)
    })

    it('drops the request\'s events as rate-limited instead of outwaiting a provider pause', async () => {
      vi.stubEnv('VERCEL', '1')

      onTestFinished(() => vi.unstubAllEnvs())
      const drain = vi.fn().mockRejectedValue(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 60_000 }))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 5000 }, onDropped })(drain)

      hook(createTestContext(1))
      let first = false
      void deliverPendingDrains().then(() => {
        first = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(first).toBe(true)

      hook(createTestContext(2))
      let second = false
      void deliverPendingDrains().then(() => {
        second = true
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(second).toBe(true)
      expect(drain).toHaveBeenCalledOnce()
      expect(hook.stats().dropped['rate-limited']).toBe(2)
      expect(hook.pending).toBe(0)
      expect(onDropped.mock.calls.map(([events, , reason]) => [events.map((ctx: DrainContext) => ctx.event.id), reason])).toEqual([[[1], 'rate-limited'], [[2], 'rate-limited']])
    })
  })

  describe('request budget and deadline', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
      delete (globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')]
    })

    it('stops a request-end flush at requestBudget sends, retries included, and drops the rest as deferred', async () => {
      vi.stubEnv('VERCEL', '1')
      const drain = vi.fn().mockRejectedValue(new DrainDeliveryError('unavailable', { status: 503, retryable: true }))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 5000 }, retry: { maxAttempts: 5, initialDelayMs: 10 }, requestBudget: 2, onDropped })(drain)

      hook(createTestContext(1))
      let done = false
      void deliverPendingDrains().then(() => {
        done = true
      })
      await vi.advanceTimersByTimeAsync(100)

      expect(done).toBe(true)
      expect(drain).toHaveBeenCalledTimes(2)
      expect(hook.stats().dropped.deferred).toBe(1)
      expect(onDropped.mock.calls.map(([, , reason]) => reason)).toEqual(['deferred'])
    })

    it('drops an exhausted request-end flush without waiting for a retry it cannot make', async () => {
      vi.stubEnv('VERCEL', '1')
      const drain = vi.fn().mockRejectedValue(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 20_000 }))
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 5000 }, retry: { maxAttempts: 5 }, requestBudget: 1, onDropped: vi.fn() })(drain)

      hook(createTestContext(1))
      let done = false
      void deliverPendingDrains().then(() => {
        done = true
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(drain).toHaveBeenCalledOnce()
      expect(done).toBe(true)
      expect(hook.stats().dropped.deferred).toBe(1)
    })

    it('drops only the exhausted flush\'s events from a batch that also holds later ones', async () => {
      vi.stubEnv('VERCEL', '1')
      const drain = vi.fn()
        .mockRejectedValueOnce(new DrainDeliveryError('unavailable', { status: 503, retryable: true }))
        .mockResolvedValue(undefined)
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 5000 }, retry: { maxAttempts: 5, initialDelayMs: 10 }, requestBudget: 1, onDropped })(drain)

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(5000)
      expect(drain).toHaveBeenCalledOnce()

      // Holds event 1 (waiting to retry) and event 2; the retry of 1 spends its only send.
      hook(createTestContext(2))
      void deliverPendingDrains()
      hook(createTestContext(3))
      await vi.advanceTimersByTimeAsync(100)

      expect(drain.mock.calls.map(([batch]) => (batch as DrainContext[]).map(ctx => ctx.event.id))).toEqual([[1], [1], [3]])
      expect(onDropped.mock.calls.map(([events, , reason]) => [events.map((ctx: DrainContext) => ctx.event.id), reason])).toEqual([[[2], 'deferred']])
      expect(hook.stats().delivered).toBe(2)
    })

    it('reports every copy of an event pushed twice when its request runs out of budget', async () => {
      vi.stubEnv('VERCEL', '1')
      const drain = vi.fn().mockRejectedValue(new DrainDeliveryError('unavailable', { status: 503, retryable: true }))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 5000 }, retry: { maxAttempts: 5, initialDelayMs: 10 }, requestBudget: 1, onDropped })(drain)

      const ctx = createTestContext(1)
      hook(ctx)
      hook(ctx)
      void deliverPendingDrains()
      await vi.advanceTimersByTimeAsync(100)

      expect(onDropped.mock.calls.map(([events, , reason]) => [events.length, reason])).toEqual([[2, 'deferred']])
      expect(hook.stats().dropped.deferred).toBe(2)
    })

    it('keeps every flush() retry when a request-end flush joins the batch', async () => {
      vi.stubEnv('VERCEL', '1')
      const drain = vi.fn()
        .mockRejectedValueOnce(new Error('a'))
        .mockRejectedValueOnce(new Error('b'))
        .mockResolvedValue(undefined)
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 5000 }, retry: { maxAttempts: 3, initialDelayMs: 10 }, requestBudget: 1, onDropped: vi.fn() })(drain)

      hook(createTestContext(1))
      void hook.flush()
      void deliverPendingDrains()
      await vi.advanceTimersByTimeAsync(100)

      expect(drain).toHaveBeenCalledTimes(3)
      expect(hook.stats().delivered).toBe(1)
      expect(hook.stats().dropped.deferred).toBe(0)
    })

    it('cuts a running retry wait short when a later request-end flush brings an earlier deadline', async () => {
      vi.stubEnv('VERCEL', '1')
      const drain = vi.fn().mockRejectedValue(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 20_000 }))
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 5000 }, retry: { maxAttempts: 5 }, onDropped: vi.fn() })(drain)

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(5000)
      expect(drain).toHaveBeenCalledOnce()

      const deadline = Date.now() + 3000
      ;(globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')] = { get: () => ({ deadline }) }
      let done = false
      void deliverPendingDrains().then(() => {
        done = true
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(done).toBe(true)
      expect(drain).toHaveBeenCalledOnce()
      expect(hook.stats().dropped.deadline).toBe(1)
    })

    it('skips a retry that would start past 25 s after the request ended on Workers', async () => {
      vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
      const drain = vi.fn().mockRejectedValue(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 20_000 }))
      const onDropped = vi.fn()
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 5000 }, retry: { maxAttempts: 5 }, onDropped })(drain)

      hook(createTestContext(1))
      let done = false
      void deliverPendingDrains().then(() => {
        done = true
      })
      await vi.advanceTimersByTimeAsync(20_000)

      expect(drain).toHaveBeenCalledTimes(2)
      expect(done).toBe(true)
      expect(hook.stats().dropped.deadline).toBe(1)
      expect(onDropped.mock.calls.map(([, , reason]) => reason)).toEqual(['deadline'])
    })

    it('reads the invocation deadline from the Vercel request context', async () => {
      vi.stubEnv('VERCEL', '1')
      const deadline = Date.now() + 3000
      ;(globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')] = { get: () => ({ deadline }) }
      const drain = vi.fn().mockRejectedValue(new DrainDeliveryError('quota', { status: 429, retryable: true, retryAfterMs: 2000 }))
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 5000 }, retry: { maxAttempts: 5 }, onDropped: vi.fn() })(drain)

      hook(createTestContext(1))
      void deliverPendingDrains()
      await vi.advanceTimersByTimeAsync(5000)

      expect(drain).toHaveBeenCalledTimes(2)
      expect(hook.stats().dropped.deadline).toBe(1)
    })

    it('leaves timer and flush() deliveries outside a request window unbounded', async () => {
      const drain = vi.fn()
        .mockRejectedValueOnce(new Error('a'))
        .mockRejectedValueOnce(new Error('b'))
        .mockResolvedValue(undefined)
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 5000 }, retry: { maxAttempts: 3, initialDelayMs: 10 }, requestBudget: 1 })(drain)

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(6000)

      expect(drain).toHaveBeenCalledTimes(3)
      expect(hook.stats().delivered).toBe(1)
    })

    it('rejects a non-positive requestBudget', () => {
      expect(() => createDrainPipeline({ requestBudget: 0 })).toThrow('requestBudget must be a positive finite number')
    })
  })

  describe('request-end snapshot', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('resolves each request on a long-lived server within one interval and a send, under traffic that never lets the pipeline idle', async () => {
      for (const name of ['VERCEL', 'NETLIFY', 'AWS_LAMBDA_FUNCTION_NAME']) vi.stubEnv(name, '')
      const drain = vi.fn((_batch: DrainContext[]) => new Promise<void>(resolve => setTimeout(resolve, 300)))
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 50, intervalMs: 1000 } })(drain)
      const latencies: number[] = []

      for (let id = 1; id <= 50; id++) {
        const endedAt = Date.now()
        hook(createTestContext(id))
        void deliverPendingDrains().then(() => {
          latencies.push(Date.now() - endedAt)
        })
        await vi.advanceTimersByTimeAsync(100)
      }
      await vi.advanceTimersByTimeAsync(1300)

      expect(latencies).toHaveLength(50)
      expect(Math.max(...latencies)).toBeLessThanOrEqual(1300)
      expect(drain.mock.calls[0]?.[0]).toHaveLength(10)
    })

    it('waits for events an explicit flush() is still sending', async () => {
      vi.stubEnv('VERCEL', '1')
      let accept!: () => void
      const drain = vi.fn((_batch: DrainContext[]) => new Promise<void>((resolve) => {
        accept = resolve
      }))
      const hook = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 5000 } })(drain)

      hook(createTestContext(1))
      const flushed = hook.flush()
      let done = false
      void deliverPendingDrains().then(() => {
        done = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(drain).toHaveBeenCalledOnce()
      expect(done).toBe(false)

      accept()
      await flushed
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toBe(true)
    })
  })

  describe('serverless warning', () => {
    async function loadFresh() {
      delete (globalThis as Record<symbol, unknown>)[Symbol.for('evlog.drains.v2')]
      vi.resetModules()
      const [{ createDrainPipeline: create }, { deliverPendingDrains: deliver }] = await Promise.all([
        import('../../src/pipeline'),
        import('../../src/shared/shutdown'),
      ])
      return { create, deliver }
    }

    afterEach(() => {
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    })

    it('warns once on Vercel when events wait past batch.intervalMs and no request-end flush ever ran', async () => {
      vi.stubEnv('VERCEL', '1')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { create } = await loadFresh()
      const hook = create<DrainContext>({ batch: { size: 10, intervalMs: 1000 } })(vi.fn().mockResolvedValue(undefined))

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(1000)
      hook(createTestContext(2))
      await vi.advanceTimersByTimeAsync(1000)

      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0]?.[0]).toContain('on Vercel')
    })

    it('stays quiet once an integration flushed at request end', async () => {
      vi.stubEnv('VERCEL', '1')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { create, deliver } = await loadFresh()
      const hook = create<DrainContext>({ batch: { size: 10, intervalMs: 1000 } })(vi.fn().mockResolvedValue(undefined))

      await deliver()
      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(1000)

      expect(warn).not.toHaveBeenCalled()
    })

    it('warns stale-buffer once when a request finds events a frozen invocation left behind', async () => {
      vi.stubEnv('VERCEL', '1')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { create, deliver } = await loadFresh()
      const hook = create<DrainContext>({ batch: { size: 10, intervalMs: 1000 } })(vi.fn().mockResolvedValue(undefined))
      await deliver()

      hook(createTestContext(1))
      // A frozen runtime: the clock moves on but the batch timer never fires.
      vi.setSystemTime(Date.now() + 5000)
      hook(createTestContext(2))
      vi.setSystemTime(Date.now() + 5000)
      hook(createTestContext(3))

      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0]?.[0]).toContain('stale-buffer: 1 event(s)')
    })

    it('does not warn stale-buffer while a slow send holds later events back', async () => {
      vi.stubEnv('VERCEL', '1')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { create, deliver } = await loadFresh()
      const hook = create<DrainContext>({ batch: { size: 10, intervalMs: 1000 } })(vi.fn(() => new Promise<void>(() => {})))
      await deliver()

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(1000)
      hook(createTestContext(2))
      await vi.advanceTimersByTimeAsync(5000)
      hook(createTestContext(3))

      expect(warn).not.toHaveBeenCalled()
    })

    it('does not warn stale-buffer when the batch timer fired on time', async () => {
      vi.stubEnv('VERCEL', '1')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { create, deliver } = await loadFresh()
      const hook = create<DrainContext>({ batch: { size: 10, intervalMs: 1000 } })(vi.fn().mockResolvedValue(undefined))
      await deliver()

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(1500)
      hook(createTestContext(2))

      expect(warn).not.toHaveBeenCalled()
    })

    it('stays quiet on a long-lived server', async () => {
      for (const name of ['VERCEL', 'NETLIFY', 'AWS_LAMBDA_FUNCTION_NAME']) vi.stubEnv(name, '')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { create } = await loadFresh()
      const hook = create<DrainContext>({ batch: { size: 10, intervalMs: 1000 } })(vi.fn().mockResolvedValue(undefined))

      hook(createTestContext(1))
      await vi.advanceTimersByTimeAsync(1000)

      expect(warn).not.toHaveBeenCalled()
    })
  })
})
