import type { RequestLogger } from 'evlog'

function isRequestLogger(value: unknown): value is RequestLogger {
  return typeof value === 'object'
    && value !== null
    && 'set' in value
    && typeof value.set === 'function'
}

function readContextLog(context: unknown): unknown {
  if (typeof context !== 'object' || context === null || !('log' in context)) {
    return undefined
  }
  return context.log
}

/** Narrow Nitro request context to evlog's request logger. */
export function requireRequestLogger(context: unknown): RequestLogger {
  const log = readContextLog(context)
  if (!isRequestLogger(log)) {
    throw new Error('Missing evlog request logger — is evlog/nitro registered?')
  }
  return log
}
