export interface BudgetOptions {
  /** Model calls allowed per minute across all signals. */
  perMinute: number
  /** How long to stop calling the model once it is unhealthy, in milliseconds. */
  cooldownMs: number
  /** Share of `perMinute` held for calls that decide sampling, so an error storm in `enrich` cannot spend it. */
  keepShare: number
}

/** `keep` decides sampling before the event exists; `enrich` writes columns on an event that is already kept. */
export type Lane = 'keep' | 'enrich'

export interface Budget {
  /**
   * Reserve one call. Returns how many events of the lane this one stands
   * for, itself and the ones skipped for lack of budget since the last
   * reserved call, or `false` to skip it.
   */
  take: (lane: Lane) => number | false
  /** Return a reserved call that was not made, with the events it stood for that the next call should carry. */
  refund: (lane: Lane, represents: number) => void
  succeed: () => void
  fail: () => void
}

/** Consecutive failed calls that open the breaker. One slow call is not an outage. */
const FAILURES_TO_OPEN = 3
/** Seconds of budget a bucket holds, so a burst after an idle period is bounded instead of a full minute at once. */
const BURST_SECONDS = 10

interface Bucket {
  perSecond: number
  capacity: number
  tokens: number
  refilledAt: number
}

interface Arrivals {
  windowStart: number
  count: number
  /** Admission probability until the window closes, from the arrival rate over the last window. */
  probability: number
}

function bucket(perMinute: number, at: number): Bucket {
  const perSecond = perMinute / 60
  const capacity = Math.max(1, perSecond * BURST_SECONDS)
  return { perSecond, capacity, tokens: capacity, refilledAt: at }
}

function refill(b: Bucket, t: number): void {
  b.tokens = Math.min(b.capacity, b.tokens + (t - b.refilledAt) / 1000 * b.perSecond)
  b.refilledAt = t
}

/**
 * Two token buckets, one per lane, plus a circuit breaker. When events arrive
 * faster than a lane refills, each is admitted with the probability the lane
 * can afford, so a spike is sampled evenly instead of judging its first
 * events and none of the rest. Everything fails open: a skipped event flows
 * through unjudged.
 */
export function createBudget(options: BudgetOptions, now: () => number = Date.now, random: () => number = Math.random): Budget {
  const start = now()
  const keepShare = Math.min(1, Math.max(0, options.keepShare))
  const buckets: Record<Lane, Bucket> = {
    keep: bucket(options.perMinute * keepShare, start),
    enrich: bucket(options.perMinute * (1 - keepShare), start),
  }
  const arrivals: Record<Lane, Arrivals> = {
    keep: { windowStart: start, count: 0, probability: 1 },
    enrich: { windowStart: start, count: 0, probability: 1 },
  }
  const skippedSince: Record<Lane, number> = { keep: 0, enrich: 0 }
  let failures = 0
  let openUntil = 0

  function admission(lane: Lane, t: number): number {
    const a = arrivals[lane]
    const elapsed = t - a.windowStart
    if (elapsed >= 1000) {
      // A keep event may fall back to the enrich bucket, so its lane can afford both rates.
      const affordable = buckets[lane].perSecond + (lane === 'keep' ? buckets.enrich.perSecond : 0)
      const perSecond = a.count / (elapsed / 1000)
      a.probability = perSecond === 0 ? 1 : Math.min(1, affordable / perSecond)
      a.windowStart = t
      a.count = 0
    }
    a.count++
    return a.probability
  }

  function reserve(lane: Lane, t: number): boolean {
    const probability = admission(lane, t)
    if (probability < 1 && random() >= probability) return false
    refill(buckets.keep, t)
    refill(buckets.enrich, t)
    if (buckets[lane].tokens >= 1) {
      buckets[lane].tokens--
      return true
    }
    if (lane === 'keep' && buckets.enrich.tokens >= 1) {
      buckets.enrich.tokens--
      return true
    }
    return false
  }

  return {
    take(lane) {
      const t = now()
      // An outage is not a spike: events skipped while the breaker is open are not counted toward the next verdict.
      if (t < openUntil) return false
      skippedSince[lane]++
      if (!reserve(lane, t)) return false
      const represents = skippedSince[lane]
      skippedSince[lane] = 0
      return represents
    },
    refund(lane, represents) {
      // The caller made no call, so the events this one stood for carry over to the next.
      skippedSince[lane] += represents
      const b = buckets[lane]
      b.tokens = Math.min(b.capacity, b.tokens + 1)
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
