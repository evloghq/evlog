import { vi } from 'vitest'

/**
 * Run `fn` with `vi.useFakeTimers()` enabled and restore real timers
 * afterwards. Lets tests advance the clock deterministically (`vi.advanceTimersByTime`)
 * without leaking fake timers into surrounding tests.
 *
 * @example
 * ```ts
 * await withFakeTimers(async () => {
 *   const start = logger.start()
 *   vi.advanceTimersByTime(100)
 *   await start.finish()
 *   expect(drain).toHaveBeenCalled()
 * })
 * ```
 */
export async function withFakeTimers<T>(fn: () => T | Promise<T>): Promise<T> {
  vi.useFakeTimers()
  try {
    return await fn()
  } finally {
    vi.useRealTimers()
  }
}

/**
 * Milliseconds taken by the fastest of `runs` calls of `fn`, after one untimed
 * warm-up call. Linear-time bounds assert on this: a loaded machine can pause
 * any single call, but an input that triggers super-linear work is slow on every run.
 *
 * @example
 * ```ts
 * expect(fastestRunMs(() => redactEvent({ input }, config))).toBeLessThan(100)
 * ```
 */
export function fastestRunMs(fn: () => unknown, runs = 3): number {
  fn()
  let fastest = Infinity
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    fn()
    fastest = Math.min(fastest, performance.now() - start)
  }
  return fastest
}

/**
 * Flush queued microtasks. Cheaper and more deterministic than
 * `await new Promise(r => setTimeout(r, 0))` for tests that just need
 * pending promises to settle.
 */
export async function flushMicrotasks(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}
