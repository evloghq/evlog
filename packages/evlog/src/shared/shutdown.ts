/**
 * Process-wide flush of drain pipelines that still hold events, on `SIGTERM`,
 * `SIGINT`, `beforeExit`, and the close hooks of framework integrations.
 */

/**
 * How long a signal waits for pending pipelines before the process exits:
 * inside Vercel's 500 ms shutdown window.
 */
const SIGNAL_FLUSH_DEADLINE_MS = 400

type ShutdownSignal = 'SIGTERM' | 'SIGINT'

const pending = new Set<() => Promise<void>>()
let installed = false
let shuttingDown = false

function hasSignalSupport(): boolean {
  return typeof process !== 'undefined'
    && typeof process.prependListener === 'function'
    && typeof process.kill === 'function'
}

/**
 * Flush every pipeline that holds events. A signal passes a deadline, after
 * which the process exits whatever is still in flight.
 */
export async function flushPendingDrains(deadlineMs?: number): Promise<void> {
  if (pending.size === 0) return
  const flushes = Promise.allSettled(Array.from(pending, flush => flush()))
  if (deadlineMs === undefined) {
    await flushes
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    flushes,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deadlineMs)
    }),
  ])
  clearTimeout(timer)
}

function removeListeners(): void {
  process.off('SIGTERM', onSigterm)
  process.off('SIGINT', onSigint)
  process.off('beforeExit', onBeforeExit)
}

function onSignal(signal: ShutdownSignal): void {
  // Listening to a signal cancels Node's default exit, so evlog re-raises it,
  // unless another listener took over the shutdown. Read before `once` wrappers remove themselves.
  const handledElsewhere = process.listenerCount(signal) > 1
  if (shuttingDown) {
    if (!handledElsewhere) {
      removeListeners()
      process.kill(process.pid, signal)
    }
    return
  }
  shuttingDown = true
  void flushPendingDrains(SIGNAL_FLUSH_DEADLINE_MS).then(() => {
    shuttingDown = false
    if (handledElsewhere) return
    removeListeners()
    process.kill(process.pid, signal)
  })
}

function onSigterm(): void {
  onSignal('SIGTERM')
}

function onSigint(): void {
  onSignal('SIGINT')
}

function onBeforeExit(): void {
  void flushPendingDrains()
}

/** Called by a pipeline when it starts holding events (`true`) and once it is idle again (`false`). */
export function trackPendingDrain(flush: () => Promise<void>, isPending: boolean): void {
  if (!isPending) {
    pending.delete(flush)
    return
  }
  pending.add(flush)
  if (installed || !hasSignalSupport()) return
  installed = true
  process.prependListener('SIGTERM', onSigterm)
  process.prependListener('SIGINT', onSigint)
  process.on('beforeExit', onBeforeExit)
}
