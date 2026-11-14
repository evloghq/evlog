import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCachedStatsForFilter, resetStatsCache } from '../server/utils/stats-cache'

/**
 * `getRunsCursor`/`getStatsForFilter` reach the cache as Nuxt auto-imports,
 * i.e. as free identifiers resolved off `globalThis` at call time — so the
 * test stands them up there rather than mocking a module path.
 */
const globals = globalThis as Record<string, unknown>

let cursorId: number
let statsCalls: number
let statsImpl: (filter: RunsFilter) => Promise<StatsResponse>

/** Only the fields the cache itself touches; the rest of `StatsResponse` is irrelevant here. */
function statsFor(filter: RunsFilter, call: number): StatsResponse {
  return { range: filter.range, call } as unknown as StatsResponse
}

const FILTER: RunsFilter = { range: '7d' }

beforeEach(() => {
  resetStatsCache()
  vi.useFakeTimers()
  cursorId = 1
  statsCalls = 0
  statsImpl = (filter) => {
    statsCalls++
    return Promise.resolve(statsFor(filter, statsCalls))
  }
  globals.getRunsCursor = () => Promise.resolve({ latestId: cursorId, latestAt: null })
  globals.getStatsForFilter = (filter: RunsFilter) => statsImpl(filter)
})

afterEach(() => {
  vi.useRealTimers()
  delete globals.getRunsCursor
  delete globals.getStatsForFilter
})

describe('getCachedStatsForFilter', () => {
  it('computes once and reuses the result while the cursor is unchanged', async () => {
    await getCachedStatsForFilter(FILTER)
    vi.advanceTimersByTime(10_000)
    await getCachedStatsForFilter(FILTER)

    expect(statsCalls).toBe(1)
  })

  it('recomputes once the cursor moves', async () => {
    await getCachedStatsForFilter(FILTER)
    vi.advanceTimersByTime(10_000)
    cursorId = 2
    await getCachedStatsForFilter(FILTER)

    expect(statsCalls).toBe(2)
  })

  it('holds a fresh entry for a few seconds even when new events land', async () => {
    await getCachedStatsForFilter(FILTER)
    // Under the 5s floor: a burst of ingests must not trigger a burst of
    // 14-query aggregations.
    vi.advanceTimersByTime(1000)
    cursorId = 2
    await getCachedStatsForFilter(FILTER)
    vi.advanceTimersByTime(1000)
    cursorId = 3
    await getCachedStatsForFilter(FILTER)

    expect(statsCalls).toBe(1)
  })

  it('stamps each response with the cursor it was computed at', async () => {
    await expect(getCachedStatsForFilter(FILTER)).resolves.toMatchObject({ call: 1, cursorId: 1 })

    vi.advanceTimersByTime(1000)
    cursorId = 2
    // Served from under the floor: the stamp still says 1, so a client that
    // probed 2 knows this response does not include the new event yet.
    await expect(getCachedStatsForFilter(FILTER)).resolves.toMatchObject({ call: 1, cursorId: 1 })

    vi.advanceTimersByTime(5000)
    await expect(getCachedStatsForFilter(FILTER)).resolves.toMatchObject({ call: 2, cursorId: 2 })
  })

  it('reuses a result for a few minutes while the cursor is unchanged', async () => {
    await getCachedStatsForFilter(FILTER)
    vi.advanceTimersByTime(4 * 60_000)
    await getCachedStatsForFilter(FILTER)

    expect(statsCalls).toBe(1)
  })

  it('recomputes after the max age even with no new events: the window slides', async () => {
    await getCachedStatsForFilter(FILTER)
    vi.advanceTimersByTime(5 * 60_000 + 1000)
    await getCachedStatsForFilter(FILTER)

    expect(statsCalls).toBe(2)
  })

  it('collapses concurrent misses into a single computation', async () => {
    const results = await Promise.all([
      getCachedStatsForFilter(FILTER),
      getCachedStatsForFilter(FILTER),
      getCachedStatsForFilter(FILTER),
    ])

    expect(statsCalls).toBe(1)
    expect(results[0]).toBe(results[1])
    expect(results[1]).toBe(results[2])
  })

  it('caches each filter separately', async () => {
    await getCachedStatsForFilter({ range: '7d' })
    await getCachedStatsForFilter({ range: '30d' })
    await getCachedStatsForFilter({ range: '7d', tool: 'evlog-cli' })
    await getCachedStatsForFilter({ range: '7d' })

    expect(statsCalls).toBe(3)
  })

  it('does not remember a failed computation', async () => {
    statsImpl = () => {
      statsCalls++
      return Promise.reject(new Error('database unavailable'))
    }
    await expect(getCachedStatsForFilter(FILTER)).rejects.toThrow('database unavailable')

    statsImpl = (filter) => {
      statsCalls++
      return Promise.resolve(statsFor(filter, statsCalls))
    }
    await expect(getCachedStatsForFilter(FILTER)).resolves.toMatchObject({ range: '7d' })
    expect(statsCalls).toBe(2)
  })

  it('bounds the cache so user-controlled filter values cannot grow it without limit', async () => {
    for (let i = 0; i < 200; i++) {
      await getCachedStatsForFilter({ range: '7d', tool: `tool-${i}` })
    }
    expect(statsCalls).toBe(200)

    // The most recent filters are still cached; the oldest were evicted.
    await getCachedStatsForFilter({ range: '7d', tool: 'tool-199' })
    expect(statsCalls).toBe(200)

    await getCachedStatsForFilter({ range: '7d', tool: 'tool-0' })
    expect(statsCalls).toBe(201)
  })

  it('caches each source separately', async () => {
    // Regression: `source` was added to the filter but not to the cache key, so
    // every source was served the first one's numbers — indistinguishable from
    // the filter silently doing nothing.
    await getCachedStatsForFilter({ range: '7d', source: { kind: 'agent', id: 'claude-code' } })
    await getCachedStatsForFilter({ range: '7d', source: { kind: 'ci', id: 'github_actions' } })
    await getCachedStatsForFilter({ range: '7d', source: { kind: 'terminal', id: 'terminal' } })
    await getCachedStatsForFilter({ range: '7d' })

    expect(statsCalls).toBe(4)
  })

  it('keeps filters apart whose values would run together under a printable separator', async () => {
    await getCachedStatsForFilter({ range: '7d', tool: 'a', environment: 'b c' })
    await getCachedStatsForFilter({ range: '7d', tool: 'a b', environment: 'c' })

    // Two distinct filters, so two distinct aggregations — one must never be
    // served the other's numbers.
    expect(statsCalls).toBe(2)
  })
})
