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

/** What a pipeline that holds events registers. */
export interface PendingDrain {
  flush: () => Promise<void>
  /** Sends the events held now without waiting for `batch.intervalMs`; resolves once they are delivered or dropped. */
  flushHeld: () => Promise<void>
  /** Resolves once the events held now are delivered or dropped, on the pipeline's own schedule. */
  waitHeld: () => Promise<void>
}

/** Platforms that freeze or stop the runtime once the response is sent. */
export function detectServerlessPlatform(): string | undefined {
  if (globalThis.navigator?.userAgent === 'Cloudflare-Workers') return 'Cloudflare Workers'
  if ('Netlify' in globalThis) return 'Netlify'
  const env = typeof process === 'undefined' ? undefined : process.env
  if (env?.VERCEL) return 'Vercel'
  if (env?.NETLIFY) return 'Netlify'
  if (env?.AWS_LAMBDA_FUNCTION_NAME) return 'AWS Lambda'
  return undefined
}

interface DrainRegistry {
  pending: Set<PendingDrain>
  /** Whether a copy of evlog installed the signal listeners. */
  installed: boolean
  requestFlushSeen: boolean
}

/** Shared by every 2.x copy of evlog, so an integration flushes pipelines created by another copy and signals are handled once. */
const REGISTRY_KEY = Symbol.for('evlog.drains.v2')

const registry: DrainRegistry = ((globalThis as { [REGISTRY_KEY]?: DrainRegistry })[REGISTRY_KEY] ??= {
  pending: new Set(),
  installed: false,
  requestFlushSeen: false,
})
const { pending } = registry
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
  const flushes = Promise.allSettled(Array.from(pending, drain => drain.flush()))
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

/**
 * What an integration registers with a request's `waitUntil`. On a runtime
 * that freezes or stops after the response, it sends what every pipeline holds
 * now, including events of concurrent requests, and resolves once those are
 * delivered or dropped; events pushed afterwards do not extend it. On a
 * long-lived server, where srvx and `next start` also expose `waitUntil`, it
 * waits for the events held now on the pipelines' own schedule, so batches
 * keep filling up to `batch.intervalMs` and steady traffic cannot hold it open.
 */
export async function deliverPendingDrains(): Promise<void> {
  registry.requestFlushSeen = true
  if (pending.size === 0) return
  const serverless = detectServerlessPlatform() !== undefined
  await Promise.allSettled(Array.from(pending, drain => serverless ? drain.flushHeld() : drain.waitHeld()))
}

/** Whether an integration has run a request-end flush in this process. */
export function hasRequestFlushRun(): boolean {
  return registry.requestFlushSeen
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
export function trackPendingDrain(drain: PendingDrain, isPending: boolean): void {
  if (!isPending) {
    pending.delete(drain)
    return
  }
  pending.add(drain)
  if (registry.installed || !hasSignalSupport()) return
  registry.installed = true
  process.prependListener('SIGTERM', onSigterm)
  process.prependListener('SIGINT', onSigint)
  process.on('beforeExit', onBeforeExit)
}
