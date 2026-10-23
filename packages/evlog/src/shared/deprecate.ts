import { claimDeprecationWarning } from './globalRegistry'

/**
 * Show a deprecation warning for an API or option removed in the next major.
 *
 * - Plain `console.warn`, never routed through evlog's logger or drains.
 * - Once per process per `id`, so duplicated evlog copies warn once.
 * - Silent in production and test, under Vitest or Jest, and when
 *   `EVLOG_NO_DEPRECATION_WARNINGS` is `1` or `true`. A silenced call does not
 *   consume the `id`.
 *
 * Call it where the deprecated thing is used (a factory, an option resolver, a
 * getter), not at import time. `message` is the full line, `[evlog/<area>]`
 * prefix included.
 */
export function warnDeprecated(id: string, message: string): void {
  if (isDeprecationWarningSilenced()) return
  if (!claimDeprecationWarning(id)) return
  console.warn(message)
}

function isDeprecationWarningSilenced(): boolean {
  // Browser bundles have no `process`; they warn like development does.
  if (typeof process === 'undefined') return false
  const { env } = process
  if (env.NODE_ENV === 'production' || env.NODE_ENV === 'test') return true
  if (env.VITEST || env.JEST_WORKER_ID) return true
  return env.EVLOG_NO_DEPRECATION_WARNINGS === '1' || env.EVLOG_NO_DEPRECATION_WARNINGS === 'true'
}
