/**
 * Tiny rAF-based sequencer for inline doc demos.
 *
 * Drives a list of timed events (each with a `at` ms offset and a `run` callback)
 * along a single virtual timeline. Supports pause / resume / restart so readers
 * can stop a looping demo to inspect a state, then play it back.
 *
 * Honors `prefers-reduced-motion` by firing every event immediately on start
 * (so the final state is shown without animation), and is meant to be wired to
 * an `IntersectionObserver` from the consuming component.
 */

export interface TimedEvent {
  /** Time in milliseconds from the start of the cycle. */
  at: number
  /** Callback invoked once when `elapsed` first crosses `at`. */
  run: () => void
}

export interface UseTimedSequenceOptions {
  events: TimedEvent[]
  /** Total duration of one cycle (incl. any tail hold), in ms. */
  totalDuration: number
  /** Loop back to the start when totalDuration is reached. */
  loop?: boolean
  /** When true, fire all events immediately on `start()` and never tick. */
  reducedMotion?: boolean
  /** Reset consumer state to its initial values (called on cycle loop and `restart()`). */
  onReset?: () => void
}

export function useTimedSequence(opts: UseTimedSequenceOptions) {
  const elapsed = ref(0)
  const paused = ref(false)
  const started = ref(false)

  let rafId: number | undefined
  let lastTimestamp = 0
  let nextEventIdx = 0

  function tick(timestamp: number) {
    if (lastTimestamp === 0) {
      lastTimestamp = timestamp
      rafId = requestAnimationFrame(tick)
      return
    }
    const delta = timestamp - lastTimestamp
    lastTimestamp = timestamp
    elapsed.value += delta

    while (
      nextEventIdx < opts.events.length
      && (opts.events[nextEventIdx]?.at ?? Infinity) <= elapsed.value
    ) {
      opts.events[nextEventIdx]?.run()
      nextEventIdx++
    }

    if (elapsed.value >= opts.totalDuration) {
      if (opts.loop) {
        opts.onReset?.()
        elapsed.value = 0
        nextEventIdx = 0
      } else {
        stop()
        return
      }
    }

    if (!paused.value) {
      rafId = requestAnimationFrame(tick)
    }
  }

  function start() {
    if (started.value) return
    started.value = true
    if (opts.reducedMotion) {
      opts.events.forEach(e => e.run())
      return
    }
    lastTimestamp = 0
    rafId = requestAnimationFrame(tick)
  }

  function pause() {
    if (paused.value || !started.value) return
    paused.value = true
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId)
      rafId = undefined
    }
  }

  function resume() {
    if (!paused.value || !started.value) return
    paused.value = false
    lastTimestamp = 0
    rafId = requestAnimationFrame(tick)
  }

  function toggle() {
    if (paused.value) resume()
    else pause()
  }

  function restart() {
    opts.onReset?.()
    elapsed.value = 0
    nextEventIdx = 0
    paused.value = false
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId)
      rafId = undefined
    }
    if (!started.value) {
      start()
      return
    }
    lastTimestamp = 0
    rafId = requestAnimationFrame(tick)
  }

  function stop() {
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId)
      rafId = undefined
    }
    started.value = false
  }

  onBeforeUnmount(stop)

  return {
    start,
    pause,
    resume,
    toggle,
    restart,
    stop,
    paused: readonly(paused),
    started: readonly(started),
    elapsed: readonly(elapsed),
  }
}
