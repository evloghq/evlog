/** Matches `parseIngestBody` default `maxBatchSize`. */
export const MAX_FLUSH_BATCH = 50

/** Default outbox size that forces a flush inside the coalescing window. */
export const DEFAULT_FLUSH_THRESHOLD = 20

/** Default minimum time between successful HTTP flushes. */
export const DEFAULT_FLUSH_INTERVAL_MS = 15 * 60 * 1000

/** Coalescing window in CI, where commands are frequent. */
export const CI_FLUSH_INTERVAL_MS = 60 * 60 * 1000

const INTERVAL_ENV = 'EVLOG_TELEMETRY_FLUSH_INTERVAL_MS'
const THRESHOLD_ENV = 'EVLOG_TELEMETRY_FLUSH_THRESHOLD'

function readEnvNumber(env: NodeJS.Dict<string>, key: string): number | undefined {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  return n
}

/**
 * Resolve the coalescing window: env → option → 60 minutes in CI, else 15 minutes.
 * `0` means every `run()` POSTs.
 */
export function resolveFlushIntervalMs(
  option?: number,
  ci = false,
  env: NodeJS.Dict<string> = process.env,
): number {
  const fromEnv = readEnvNumber(env, INTERVAL_ENV)
  if (fromEnv !== undefined && fromEnv >= 0) return fromEnv
  if (option !== undefined && Number.isFinite(option) && option >= 0) return option
  return ci ? CI_FLUSH_INTERVAL_MS : DEFAULT_FLUSH_INTERVAL_MS
}

/**
 * Resolve the outbox size that forces a flush: env → option → 20, capped at {@link MAX_FLUSH_BATCH}.
 */
export function resolveFlushThreshold(
  option?: number,
  env: NodeJS.Dict<string> = process.env,
): number {
  const fromEnv = readEnvNumber(env, THRESHOLD_ENV)
  const raw = fromEnv ?? option
  if (raw === undefined || !Number.isFinite(raw) || raw < 1) return DEFAULT_FLUSH_THRESHOLD
  return Math.min(Math.trunc(raw), MAX_FLUSH_BATCH)
}

/** Whether `run()` should POST after appending this event. */
export function shouldFlushOutbox(input: {
  pending: number
  lastFlushAt?: number
  oldestStoredAt?: number
  now: number
  intervalMs: number
  threshold: number
}): boolean {
  if (input.pending <= 0) return false
  if (input.pending >= input.threshold) return true
  const anchor = input.lastFlushAt ?? input.oldestStoredAt
  if (anchor === undefined) return true
  return input.now - anchor >= input.intervalMs
}
