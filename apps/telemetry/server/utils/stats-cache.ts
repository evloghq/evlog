// Explicit (unlike the rest of `server/utils/`) because the cache is unit-tested
// with plain vitest, outside Nitro's auto-import context.
import { sourceToken } from '../../shared/utils/sources'

/**
 * A stats response costs ~14 aggregate queries over the whole selected window
 * — measured at roughly 800ms of database CPU for a 30-day range and ~30ms
 * for 24h. That is far too expensive to recompute per request when several
 * dashboard tabs, and any number of MCP agents, ask for the same numbers.
 * The adoption response is smaller in query count but heavier per query (two
 * full jsonb scans and a first-seen join over the whole table).
 *
 * So results are memoized per filter and invalidated by the `runs` cursor
 * (`max(id)`), which costs a fraction of a millisecond to read. Practically:
 * an idle dashboard never recomputes, a busy one recomputes at most once per
 * `MIN_AGE_MS`, and a sliding window is never served staler than `MAX_AGE_MS`.
 *
 * `MAX_AGE_MS` is 5 minutes so a quiet dashboard (and MCP agents asking the
 * same numbers) do not wake a scale-to-zero compute just to slide the window.
 */

/** Below this age a cached entry is always reused, even if new events landed. */
const MIN_AGE_MS = 5_000
/** Above this age an entry is always recomputed. The range is a sliding window. */
const MAX_AGE_MS = 5 * 60_000
/**
 * `tool`/`environment` come from user-controlled query params, so the key
 * space is unbounded — cap it and evict the oldest entry rather than letting
 * a crafted request set grow the map without limit.
 */
const MAX_ENTRIES = 64

interface CacheEntry<T> {
  computedAt: number
  cursorId: number
  /** Stored as a promise so concurrent misses share one computation. */
  result: Promise<CursorStamped<T>>
}

/**
 * Every dimension of {@link RunsFilter} has to appear here — a filter missing
 * from the key silently serves another filter's numbers, which looks exactly
 * like the filter not working at all.
 *
 * `tool` and `environment` are arbitrary user-controlled strings, so the parts
 * are joined on a NUL — a byte none of them can contain. Any printable
 * separator would let `tool="a"`/`environment="b c"` and
 * `tool="a b"`/`environment="c"` collide on one key.
 */
function cacheKey(filter: RunsFilter): string {
  const source = filter.source ? sourceToken(filter.source) : ''
  return `${filter.range}\0${filter.tool ?? ''}\0${filter.environment ?? ''}\0${source}`
}

function isFresh(entry: CacheEntry<unknown>, cursorId: number, now: number): boolean {
  const age = now - entry.computedAt
  if (age >= MAX_AGE_MS) return false
  if (age < MIN_AGE_MS) return true
  return entry.cursorId === cursorId
}

/**
 * Wraps a per-filter aggregation in the cursor-invalidated memo described
 * above. `compute` is taken as a thunk rather than referenced directly so the
 * Nitro auto-import it resolves to is looked up at call time, which is also
 * what lets the unit tests stand one up on `globalThis`.
 */
function createFilterCache<T extends object>(compute: (filter: RunsFilter) => Promise<T>) {
  const cache = new Map<string, CacheEntry<T>>()
  /**
   * Requests that have gotten as far as probing the cursor but not yet decided
   * whether to recompute. Deciding requires an `await`, so without this a burst
   * of simultaneous misses — an SSR render, a second tab, an MCP agent — would
   * each sail past the cache and start its own aggregation.
   */
  const inFlight = new Map<string, Promise<CursorStamped<T>>>()

  async function resolve(key: string, filter: RunsFilter): Promise<CursorStamped<T>> {
    // The cheap probe that decides whether the expensive aggregation runs at all.
    const { latestId } = await getRunsCursor()

    const now = Date.now()
    const existing = cache.get(key)
    if (existing && isFresh(existing, latestId, now)) {
      return existing.result
    }

    const entry: CacheEntry<T> = {
      computedAt: now,
      cursorId: latestId,
      result: compute(filter).then(value => ({ ...value, cursorId: latestId })),
    }

    // A rejected computation must not be remembered, or the filter stays broken
    // until it ages out.
    entry.result.catch(() => {
      if (cache.get(key) === entry) cache.delete(key)
    })

    // Re-insert so `cache.keys()` stays ordered by recency for the eviction below.
    cache.delete(key)
    cache.set(key, entry)

    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }

    return entry.result
  }

  function get(filter: RunsFilter): Promise<CursorStamped<T>> {
    const key = cacheKey(filter)
    const existing = cache.get(key)

    // Below the floor the answer is "reuse it" regardless of the cursor, so skip
    // the probe entirely — this is the path a busy dashboard takes most often.
    if (existing && Date.now() - existing.computedAt < MIN_AGE_MS) {
      return existing.result
    }

    const pending = inFlight.get(key)
    if (pending) return pending

    // Registered synchronously, before `resolve` reaches its first `await`, so a
    // concurrent caller is guaranteed to find it here rather than duplicating it.
    const promise = resolve(key, filter).finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key)
    })
    inFlight.set(key, promise)
    return promise
  }

  function reset(): void {
    cache.clear()
    inFlight.clear()
  }

  return { get, reset }
}

const statsCache = createFilterCache(filter => getStatsForFilter(filter))
const adoptionCache = createFilterCache(filter => getAdoptionForFilter(filter))

/** Test seam — drops every memoized response. */
export function resetStatsCache(): void {
  statsCache.reset()
  adoptionCache.reset()
}

/**
 * {@link getStatsForFilter} behind the cursor-invalidated memo described
 * above. Use this for anything request-driven; call `getStatsForFilter`
 * directly only when a guaranteed-fresh read matters more than the cost.
 */
export function getCachedStatsForFilter(filter: RunsFilter): Promise<CursorStamped<StatsResponse>> {
  return statsCache.get(filter)
}

/** {@link getAdoptionForFilter} behind the same memo. */
export function getCachedAdoptionForFilter(filter: RunsFilter): Promise<CursorStamped<AdoptionResponse>> {
  return adoptionCache.get(filter)
}
