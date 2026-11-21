import type { PendingDrain } from './shared/shutdown'
import { detectServerlessPlatform, hasRequestFlushRun, trackPendingDrain } from './shared/shutdown'

/**
 * Why the pipeline dropped events:
 * - `buffer-full`: `maxBufferSize` was reached and the oldest events made room.
 * - `rejected`: the provider answered with a status that fails the same way on every attempt, such as a `400`.
 * - `retries-exhausted`: every one of `retry.maxAttempts` failed.
 * - `rate-limited`: `flush()` ran while the provider's `Retry-After` was still in force.
 */
export type DrainDropReason = 'buffer-full' | 'rejected' | 'retries-exhausted' | 'rate-limited'

/** Counters returned by {@link PipelineDrainFn.stats}, in events since the pipeline was created. */
export interface DrainPipelineStats {
  delivered: number
  dropped: Record<DrainDropReason, number>
}

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
    /**
     * Upper bound (ms) for any single retry delay. A provider `Retry-After`
     * longer than this pauses the pipeline instead: the batch stays buffered
     * and is sent again once the delay has passed.
     * @default 30000
     */
    maxDelayMs?: number
  }
  /** Maximum number of events held in the buffer. When exceeded, the oldest event is dropped. @default 1000 */
  maxBufferSize?: number
  /**
   * Called with every event the pipeline drops, the delivery error when there
   * is one, and the reason. Without it, drops are logged with `console.error`
   * at most once a minute, with the count per reason. When the provider
   * accepted part of a batch, such as an OTLP `partialSuccess`, `events` is the
   * whole batch because the provider does not say which events it rejected;
   * `error.rejected` and `stats()` have the count.
   */
  onDropped?: (events: T[], error: Error | undefined, reason: DrainDropReason) => void
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
  /** Events delivered and dropped (per reason) since the pipeline was created. */
  stats: () => DrainPipelineStats
}

const DROP_LOG_INTERVAL_MS = 60_000

let serverlessWarned = false

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

/** `setTimeout` fires after 1 ms when asked to wait longer than this. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Fields of a `DrainDeliveryError` (from `evlog/toolkit`) the pipeline reads off any thrown error. */
interface DeliveryFailure {
  retryable?: boolean
  retryAfterMs?: number
  rejected?: number
}

/**
 * Create a drain pipeline that batches events, retries on failure, and manages buffer overflow.
 *
 * Returns a higher-order function: pass your drain adapter to get a hook-compatible function.
 *
 * Adapter drains built with `defineDrain` / `defineHttpDrain` are unwrapped to
 * their throwing `raw` variant, so `retry` and `onDropped` observe delivery
 * failures and the pipeline owns retries alone. A failure marked
 * `retryable: false` (such as a `400`) is dropped without retrying, and a
 * provider's `Retry-After` replaces the backoff delay. On serverless runtimes,
 * register `settled()` with `waitUntil` (the framework integrations do this
 * automatically) so buffered events are delivered before the instance freezes.
 *
 * On Node and Bun, a pipeline holding events is flushed on `SIGTERM` and
 * `SIGINT` (for up to 400 ms, then the signal's default exit runs unless the
 * app handles it), on `beforeExit`, and when a framework integration closes.
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
    let flushTail: Promise<void> | null = null
    let pausedUntil = 0
    let pauseError: Error | undefined
    let delivered = 0
    const dropped: Record<DrainDropReason, number> = { 'buffer-full': 0, 'rejected': 0, 'retries-exhausted': 0, 'rate-limited': 0 }
    let unlogged: Partial<Record<DrainDropReason, number>> = {}
    let unloggedError: Error | undefined
    let lastDropLogAt = Number.NEGATIVE_INFINITY
    /** When the buffer last went from empty to holding events. */
    let bufferedSince = 0
    const inFlight = new Set<T[]>()
    let heldWaiters: Array<{ events: Set<T>, resolve: () => void }> = []

    function pauseRemainingMs(): number {
      return Math.max(0, pausedUntil - Date.now())
    }

    function isIdle(): boolean {
      return buffer.length === 0 && !activeFlush && activeFlushCalls === 0
    }

    function notifySettled(): void {
      if (!isIdle()) return
      trackPendingDrain(registration, false)
      if (settleWaiters.length === 0) return
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
        warnIfNotFlushedAtRequestEnd()
        if (!activeFlush) startFlush()
      // A paused pipeline resumes when the pause ends; startFlush() re-arms the timer if it was extended.
      }, Math.min(pauseRemainingMs() || intervalMs, MAX_TIMER_DELAY_MS))
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
      const capped = Math.min(delay, maxDelayMs)
      // Half the delay plus a random share of the other half, so instances that failed together do not retry together.
      return capped / 2 + Math.random() * (capped / 2)
    }

    function logUnlogged(): void {
      const entries = Object.entries(unlogged)
      if (entries.length === 0) return
      lastDropLogAt = Date.now()
      const total = entries.reduce((sum, [, count]) => sum + count, 0)
      const breakdown = entries.map(([reason, count]) => `${count} ${reason}`).join(', ')
      console.error(`[evlog/pipeline] Dropped ${total} event(s): ${breakdown}. Pass onDropped to handle drops; drain.stats() has the totals.`, ...(unloggedError ? [unloggedError] : []))
      unlogged = {}
      unloggedError = undefined
    }

    function warnIfNotFlushedAtRequestEnd(): void {
      if (serverlessWarned || buffer.length === 0 || Date.now() - bufferedSince < intervalMs || hasRequestFlushRun()) return
      const platform = detectServerlessPlatform()
      if (!platform) return
      serverlessWarned = true
      console.warn(`[evlog/pipeline] Events waited longer than batch.intervalMs on ${platform}, which can freeze or stop the runtime once the response is sent. Pass the platform's waitUntil to the evlog integration so each request delivers its events before it ends.`)
    }

    /** Resolves request-end waiters whose events are all delivered or dropped. */
    function release(events: T[]): void {
      if (heldWaiters.length === 0) return
      heldWaiters = heldWaiters.filter((waiter) => {
        for (const event of events) waiter.events.delete(event)
        if (waiter.events.size > 0) return true
        waiter.resolve()
        return false
      })
    }

    function drop(events: T[], reason: DrainDropReason, error?: Error, count = events.length): void {
      if (events.length === 0) return
      release(events)
      dropped[reason] += count
      if (onDropped) {
        onDropped(events, error, reason)
        return
      }
      unlogged[reason] = (unlogged[reason] ?? 0) + count
      unloggedError = error ?? unloggedError
      if (Date.now() - lastDropLogAt >= DROP_LOG_INTERVAL_MS) logUnlogged()
    }

    /**
     * Resolves `'paused'` without dropping when the provider asked to wait
     * longer than `maxDelayMs`: the caller decides whether the batch waits.
     */
    async function sendWithRetry(batch: T[]): Promise<'done' | 'paused'> {
      for (let attempt = 1; ; attempt++) {
        // Another delivery may have paused the pipeline while this one waited to retry.
        if (attempt > 1 && pauseRemainingMs() > 0) return 'paused'
        try {
          await send(batch)
          delivered += batch.length
          release(batch)
          return 'done'
        } catch (error) {
          const lastError = error instanceof Error ? error : new Error(String(error))
          const failure = error as DeliveryFailure | null | undefined
          if (failure?.retryable === false) {
            const rejected = typeof failure.rejected === 'number' ? Math.min(failure.rejected, batch.length) : batch.length
            delivered += batch.length - rejected
            drop(batch, 'rejected', lastError, rejected)
            return 'done'
          }
          const retryAfterMs = typeof failure?.retryAfterMs === 'number' ? failure.retryAfterMs : undefined
          if (retryAfterMs !== undefined && retryAfterMs > maxDelayMs) {
            if (Date.now() + retryAfterMs > pausedUntil) {
              pausedUntil = Date.now() + retryAfterMs
              pauseError = lastError
            }
            // A timer armed before the pause would fire at its old deadline, not when the pause ends.
            if (timer !== null) {
              clearTimer()
              scheduleFlush()
            }
            return 'paused'
          }
          if (attempt >= maxAttempts) {
            drop(batch, 'retries-exhausted', lastError)
            return 'done'
          }
          await new Promise<void>(r => setTimeout(r, retryAfterMs ?? getRetryDelay(attempt)))
        }
      }
    }

    function dropOverflow(): void {
      if (buffer.length <= maxBufferSize) return
      drop(buffer.splice(0, buffer.length - maxBufferSize), 'buffer-full')
    }

    async function drainBuffer(): Promise<void> {
      while (buffer.length > 0 && pauseRemainingMs() === 0) {
        const batch = buffer.splice(0, batchSize)
        inFlight.add(batch)
        const outcome = await sendWithRetry(batch).finally(() => inFlight.delete(batch))
        if (outcome === 'paused') {
          buffer.unshift(...batch)
          dropOverflow()
        }
      }
    }

    /** A request-end flush cannot outwait a provider pause: the runtime may stop first. */
    function dropHeldWhilePaused(): void {
      if (heldWaiters.length === 0 || pauseRemainingMs() === 0) return
      const held = new Set(heldWaiters.flatMap(waiter => [...waiter.events]))
      const kept = buffer.filter(event => !held.has(event))
      const gone = buffer.filter(event => held.has(event))
      buffer.splice(0, buffer.length, ...kept)
      drop(gone, 'rate-limited', pauseError)
    }

    function startFlush(): void {
      if (activeFlush) return
      if (pauseRemainingMs() > 0) {
        scheduleFlush()
        return
      }
      activeFlush = drainBuffer().finally(() => {
        activeFlush = null
        dropHeldWhilePaused()
        if (buffer.length > 0 && (buffer.length >= batchSize || heldWaiters.length > 0) && pauseRemainingMs() === 0) {
          startFlush()
        } else if (buffer.length > 0) {
          scheduleFlush()
        } else {
          notifySettled()
        }
      })
    }

    function push(ctx: T): void {
      trackPendingDrain(registration, true)
      warnIfNotFlushedAtRequestEnd()
      if (buffer.length >= maxBufferSize) {
        drop(buffer.splice(0, 1), 'buffer-full')
      }
      if (buffer.length === 0) bufferedSince = Date.now()
      buffer.push(ctx)

      if (buffer.length >= batchSize && pauseRemainingMs() === 0) {
        clearTimer()
        startFlush()
      } else if (!activeFlush) {
        scheduleFlush()
      }
    }

    async function flushBuffer(): Promise<void> {
      if (activeFlush) {
        await activeFlush
      }
      // Snapshot the buffer length to avoid infinite loop if push() is called during flush
      const snapshot = buffer.length
      if (snapshot === 0) return
      const toFlush = buffer.splice(0, snapshot)
      while (toFlush.length > 0) {
        const batch = toFlush.splice(0, batchSize)
        // flush() delivers now or gives up: a pause left by the provider drops the batch instead of holding shutdown.
        if (pauseRemainingMs() > 0 || await sendWithRetry(batch) === 'paused') {
          drop(batch, 'rate-limited', pauseError)
        }
      }
    }

    function flush(): Promise<void> {
      clearTimer()
      // Counted so settled() stays pending while a spliced batch is in flight.
      activeFlushCalls++
      // A flush waits for one still running: that one already spliced its events out of the buffer.
      const run = (flushTail ? flushTail.then(flushBuffer) : flushBuffer()).finally(() => {
        // flush() usually precedes exit: report drops still waiting for the next log window.
        logUnlogged()
        activeFlushCalls--
        notifySettled()
      })
      const tail = run.then(() => undefined, () => undefined)
      flushTail = tail
      void tail.then(() => {
        if (flushTail === tail) flushTail = null
      })
      return run
    }

    function flushHeld(): Promise<void> {
      const events = new Set<T>(buffer)
      for (const batch of inFlight) {
        for (const event of batch) events.add(event)
      }
      if (events.size === 0) return Promise.resolve()
      const done = new Promise<void>((resolve) => {
        heldWaiters.push({ events, resolve })
      })
      dropHeldWhilePaused()
      if (buffer.length > 0 && pauseRemainingMs() === 0) {
        clearTimer()
        startFlush()
      }
      return done
    }

    const registration: PendingDrain = { flush, flushHeld, settled }

    function settled(): Promise<void> {
      if (isIdle()) return Promise.resolve()
      return new Promise<void>((resolve) => {
        settleWaiters.push(resolve)
      })
    }

    const hookFn = push as PipelineDrainFn<T>
    hookFn.flush = flush
    hookFn.settled = settled
    hookFn.stats = () => ({ delivered, dropped: { ...dropped } })
    Object.defineProperty(hookFn, 'pending', {
      get: () => buffer.length,
      enumerable: true,
    })

    return hookFn
  }
}
