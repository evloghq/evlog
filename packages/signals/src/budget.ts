export interface BudgetOptions {
  /** Model calls allowed per minute across all signals. */
  perMinute: number
  /** How long to stop calling the model once it is unhealthy, in milliseconds. */
  cooldownMs: number
}

export interface Budget {
  /** Reserve one call. `false` means skip this event. */
  take: () => boolean
  succeed: () => void
  fail: () => void
}

/** Consecutive failed calls that open the breaker. One slow call is not an outage. */
const FAILURES_TO_OPEN = 3

/**
 * Token bucket refilled continuously at `perMinute`, plus a circuit breaker.
 * Both fail open: when the budget is spent or the model is unhealthy, events
 * flow through unjudged.
 */
export function createBudget(options: BudgetOptions, now: () => number = Date.now): Budget {
  const perMs = options.perMinute / 60_000
  let tokens = options.perMinute
  let refilledAt = now()
  let failures = 0
  let openUntil = 0

  return {
    take() {
      const t = now()
      if (t < openUntil) return false
      tokens = Math.min(options.perMinute, tokens + (t - refilledAt) * perMs)
      refilledAt = t
      if (tokens < 1) return false
      tokens--
      return true
    },
    succeed() {
      failures = 0
      openUntil = 0
    },
    fail() {
      failures++
      if (failures >= FAILURES_TO_OPEN) openUntil = now() + options.cooldownMs
    },
  }
}
