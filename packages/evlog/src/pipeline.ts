export interface DrainPipelineOptions<T = unknown> {
  batch?: {
    /** Maximum number of events per batch sent to the drain function. @default 50 */
    size?: number
    /** Maximum time (ms) an event can stay buffered before a flush is triggered, even if the batch is not full. @default 5000 */
    intervalMs?: number
  }
  retry?: {
    /** Total number of attempts (including the initial one) before dropping the batch. @default 3 */
    maxAttempts?: number
    /** Delay strategy between retry attempts. @default 'exponential' */
    backoff?: 'exponential' | 'linear' | 'fixed'
    /** Base delay (ms) for the first retry. Scaled by the backoff strategy on subsequent retries. @default 1000 */
    initialDelayMs?: number
    /** Upper bound (ms) for any single retry delay. @default 30000 */
    maxDelayMs?: number
  }
  /** Maximum number of events held in the buffer. When exceeded, the oldest event is dropped. @default 1000 */
  maxBufferSize?: number
  /** Called when a batch is dropped after all retry attempts are exhausted, or when the buffer overflows. */
  onDropped?: (events: T[], error?: Error) => void
}

export interface PipelineDrainFn<T> {
  (ctx: T): void
  /** Flush all buffered events. Call on server shutdown. */
  flush: () => Promise<void>
  /**
   * Resolves once everything buffered so far has been delivered or dropped,
   * without forcing an early flush. Serverless integrations register it with
   * `waitUntil` so the runtime is not frozen while events sit in the buffer.
   */
  settled: () => Promise<void>
  readonly pending: number
}

/**
 * Unref a timer on runtimes that support it (Node, Bun) so an idle flush
 * scheduling timer never holds the process open. Buffered events are delivered
 * on shutdown via the documented `flush()` contract, not by keeping timers
 * alive. Retry backoff timers are intentionally left ref'd: an in-flight batch
 * is active work, and an unref'd timer awaited by `flush()` would let the
 * process exit mid-retry.
 */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as { unref?: () => void }).unref?.()
}

/**
 * Create a drain pipeline that batches events, retries on failure, and manages buffer overflow.
 *
 * Returns a higher-order function: pass your drain adapter to get a hook-compatible function.
 *
 * Adapter drains built with `defineDrain` / `defineHttpDrain` are unwrapped to
 * their throwing `raw` variant, so `retry` and `onDropped` observe delivery
 * failures and the pipeline owns retries alone. On serverless runtimes,
 * register `settled()` with `waitUntil` (the framework integrations do this
 * automatically) so buffered events are delivered before the instance freezes.
 *
 * @example
 * ```ts
 * const pipeline = createDrainPipeline({ batch: { size: 50 } })
 * const drain = pipeline(async (batch) => {
 *   await sendToBackend(batch)
 * })
 *
 * // Use as a hook
 * nitroApp.hooks.hook('evlog:drain', drain)
 *
 * // Flush on shutdown
 * nitroApp.hooks.hook('close', () => drain.flush())
 * ```
 */
export function createDrainPipeline<T = unknown>(options?: DrainPipelineOptions<T>): (drain: (batch: T[]) => void | Promise<void>) => PipelineDrainFn<T> {
  const batchSize = options?.batch?.size ?? 50
  const intervalMs = options?.batch?.intervalMs ?? 5000
  const maxBufferSize = options?.maxBufferSize ?? 1000
  const maxAttempts = options?.retry?.maxAttempts ?? 3
  const backoffStrategy = options?.retry?.backoff ?? 'exponential'
  const initialDelayMs = options?.retry?.initialDelayMs ?? 1000
  const maxDelayMs = options?.retry?.maxDelayMs ?? 30000
  const onDropped = options?.onDropped

  if (batchSize <= 0 || !Number.isFinite(batchSize)) {
    throw new Error(`[evlog/pipeline] batch.size must be a positive finite number, got: ${batchSize}`)
  }
  if (intervalMs <= 0 || !Number.isFinite(intervalMs)) {
    throw new Error(`[evlog/pipeline] batch.intervalMs must be a positive finite number, got: ${intervalMs}`)
  }
  if (maxBufferSize <= 0 || !Number.isFinite(maxBufferSize)) {
    throw new Error(`[evlog/pipeline] maxBufferSize must be a positive finite number, got: ${maxBufferSize}`)
  }
  if (maxAttempts <= 0 || !Number.isFinite(maxAttempts)) {
    throw new Error(`[evlog/pipeline] retry.maxAttempts must be a positive finite number, got: ${maxAttempts}`)
  }
  if (initialDelayMs < 0 || !Number.isFinite(initialDelayMs)) {
    throw new Error(`[evlog/pipeline] retry.initialDelayMs must be a non-negative finite number, got: ${initialDelayMs}`)
  }
  if (maxDelayMs < 0 || !Number.isFinite(maxDelayMs)) {
    throw new Error(`[evlog/pipeline] retry.maxDelayMs must be a non-negative finite number, got: ${maxDelayMs}`)
  }

  return (drain: (batch: T[]) => void | Promise<void>): PipelineDrainFn<T> => {
    // Drains built with defineDrain/defineHttpDrain swallow failures so they
    // never break a request. Their `raw` variant rejects instead — use it so
    // retry and onDropped observe real failures and own them alone.
    const rawDrain = (drain as { raw?: unknown }).raw
    const send = typeof rawDrain === 'function'
      ? rawDrain as (batch: T[]) => void | Promise<void>
      : drain
    const buffer: T[] = []
    let timer: ReturnType<typeof setTimeout> | null = null
    let activeFlush: Promise<void> | null = null
    let settleWaiters: Array<() => void> = []
    let activeFlushCalls = 0

    function isIdle(): boolean {
      return buffer.length === 0 && !activeFlush && activeFlushCalls === 0
    }

    function notifySettled(): void {
      if (!isIdle() || settleWaiters.length === 0) return
      const waiters = settleWaiters
      settleWaiters = []
      for (const resolve of waiters) resolve()
    }

    function clearTimer(): void {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    function scheduleFlush(): void {
      if (timer !== null || activeFlush) return
      timer = setTimeout(() => {
        timer = null
        if (!activeFlush) startFlush()
      }, intervalMs)
      unrefTimer(timer)
    }

    function getRetryDelay(attempt: number): number {
      let delay: number
      switch (backoffStrategy) {
        case 'linear':
          delay = initialDelayMs * attempt
          break
        case 'fixed':
          delay = initialDelayMs
          break
        case 'exponential':
        default:
          delay = initialDelayMs * 2 ** (attempt - 1)
          break
      }
      return Math.min(delay, maxDelayMs)
    }

    async function sendWithRetry(batch: T[]): Promise<void> {
      let lastError: Error | undefined
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await send(batch)
          return
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
          if (attempt < maxAttempts) {
            await new Promise<void>(r => setTimeout(r, getRetryDelay(attempt)))
          }
        }
      }
      if (onDropped) {
        onDropped(batch, lastError)
      } else {
        console.error(`[evlog/pipeline] Dropped ${batch.length} event(s) after ${maxAttempts} attempt(s):`, lastError)
      }
    }

    async function drainBuffer(): Promise<void> {
      while (buffer.length > 0) {
        const batch = buffer.splice(0, batchSize)
        await sendWithRetry(batch)
      }
    }

    function startFlush(): void {
      if (activeFlush) return
      activeFlush = drainBuffer().finally(() => {
        activeFlush = null
        if (buffer.length >= batchSize) {
          startFlush()
        } else if (buffer.length > 0) {
          scheduleFlush()
        } else {
          notifySettled()
        }
      })
    }

    function push(ctx: T): void {
      if (buffer.length >= maxBufferSize) {
        const dropped = buffer.splice(0, 1)
        onDropped?.(dropped)
      }
      buffer.push(ctx)

      if (buffer.length >= batchSize) {
        clearTimer()
        startFlush()
      } else if (!activeFlush) {
        scheduleFlush()
      }
    }

    async function flush(): Promise<void> {
      clearTimer()
      // Counted so settled() stays pending while a spliced batch is in flight.
      activeFlushCalls++
      try {
        if (activeFlush) {
          await activeFlush
        }
        // Snapshot the buffer length to avoid infinite loop if push() is called during flush
        const snapshot = buffer.length
        if (snapshot > 0) {
          const toFlush = buffer.splice(0, snapshot)
          while (toFlush.length > 0) {
            const batch = toFlush.splice(0, batchSize)
            await sendWithRetry(batch)
          }
        }
      } finally {
        activeFlushCalls--
        notifySettled()
      }
    }

    function settled(): Promise<void> {
      if (isIdle()) return Promise.resolve()
      return new Promise<void>((resolve) => {
        settleWaiters.push(resolve)
      })
    }

    const hookFn = push as PipelineDrainFn<T>
    hookFn.flush = flush
    hookFn.settled = settled
    Object.defineProperty(hookFn, 'pending', {
      get: () => buffer.length,
      enumerable: true,
    })

    return hookFn
  }
}
