export interface BudgetOptions {
  /** Model calls allowed per minute across all signals. */
  perMinute: number
  /** How long to stop calling the model after a failure, in milliseconds. */
  cooldownMs: number
}

export interface Budget {
  /** Reserve one call. `false` means skip this event. */
  take: () => boolean
  succeed: () => void
  fail: () => void
}

/**
 * Fixed one-minute window plus a circuit breaker. Both fail open: when the
 * budget is spent or the model is unhealthy, events flow through unjudged.
 */
export function createBudget(options: BudgetOptions, now: () => number = Date.now): Budget {
  let windowStart = now()
  let used = 0
  let openUntil = 0

  return {
    take() {
      const t = now()
      if (t < openUntil) return false
      if (t - windowStart >= 60_000) {
        windowStart = t
        used = 0
      }
      if (used >= options.perMinute) return false
      used++
      return true
    },
    succeed() {
      openUntil = 0
    },
    fail() {
      openUntil = now() + options.cooldownMs
    },
  }
}
