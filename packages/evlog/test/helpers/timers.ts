import { expect, vi } from 'vitest'

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
 * warm-up call. A loaded machine can pause any single call; super-linear work
 * is slow on every run.
 *
 * Linear-time tests should call {@link expectLinearTime}, which compares two
 * input sizes, not an absolute millisecond cap.
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

/** Longer input is this many times the prefix. Linear work is ~this times slower; quadratic is ~this squared. */
const SIZE_RATIO = 8
/** Max allowed (long ms / short ms) at {@link SIZE_RATIO}. Linear at 8x size is ~8; quadratic is ~64. */
const MAX_TIME_RATIO = 24
/**
 * Each timed sample repeats the call until at least this much time has elapsed,
 * then divides by the number of calls. A single sub-millisecond call is mostly
 * timer resolution; averaging over this window keeps the ratio honest without
 * flooring the short run, which would let a quadratic workload slip under the ratio.
 */
const MIN_SAMPLE_MS = 1
/** Safety valve for a clock that does not advance: stop repeating after this many calls. */
const MAX_SAMPLE_CALLS = 100_000
/** Hang / ReDoS backstop on the long input. Linear work of a ~64k string stays well under this; a quadratic scan does not. */
const LINEAR_TIME_BUDGET_MS = 2_000

/** Average ms per call, repeating `fn` until {@link MIN_SAMPLE_MS} has elapsed. */
function perCallMs(fn: () => unknown): number {
  const start = performance.now()
  let calls = 0
  let elapsed = 0
  do {
    fn()
    calls++
    elapsed = performance.now() - start
  } while (elapsed < MIN_SAMPLE_MS && calls < MAX_SAMPLE_CALLS)
  return elapsed / calls
}

/** Fastest of `runs` {@link perCallMs} samples, after one untimed warm-up call. */
function fastestPerCallMs(fn: () => unknown, runs = 3): number {
  fn()
  let fastest = Infinity
  for (let i = 0; i < runs; i++) {
    fastest = Math.min(fastest, perCallMs(fn))
  }
  return fastest
}

/**
 * Assert `fn` stays linear in `input.length`. Times an 8x-shorter prefix and
 * the full string, each as the fastest per-call average. The longer run may be
 * at most 24x the shorter; a 2 s cap on the long run catches a hang that is
 * already slow on the prefix.
 *
 * @example
 * ```ts
 * expectLinearTime(value => redactEvent({ input: value }, config), input)
 * ```
 */
export function expectLinearTime(fn: (input: string) => unknown, input: string, label?: string): void {
  const short = input.slice(0, Math.max(1, Math.floor(input.length / SIZE_RATIO)))
  const shortMs = fastestPerCallMs(() => fn(short))
  const longMs = fastestPerCallMs(() => fn(input))
  const detail = `${longMs.toFixed(1)}ms / ${shortMs.toFixed(1)}ms`
  const named = label ? `${label} (${detail})` : detail
  expect(longMs, named).toBeLessThan(LINEAR_TIME_BUDGET_MS)
  expect(longMs / shortMs, named).toBeLessThan(MAX_TIME_RATIO)
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
