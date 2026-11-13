import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLivePoller, cursorRequiresRefresh } from '../app/utils/live-poller'

const INTERVAL = 10_000
const MAX = 80_000
const IDLE = 300_000

describe('cursorRequiresRefresh', () => {
  it('refreshes on the first probe so events that landed before the baseline are not swallowed', () => {
    expect(cursorRequiresRefresh(null, 4)).toBe(true)
  })

  it('skips payloads while the cursor is unchanged', () => {
    expect(cursorRequiresRefresh(4, 4)).toBe(false)
  })

  it('refreshes once the cursor moves', () => {
    expect(cursorRequiresRefresh(4, 5)).toBe(true)
  })

  it('keeps requiring a refresh until the baseline is committed after success', () => {
    let last: number | null = null
    expect(cursorRequiresRefresh(last, 4)).toBe(true)
    expect(cursorRequiresRefresh(last, 4)).toBe(true)
    last = 4
    expect(cursorRequiresRefresh(last, 4)).toBe(false)
  })
})

describe('createLivePoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(
    refresh: () => Promise<boolean | void> | boolean | void = () => false,
    idleMs = IDLE,
  ) {
    const poller = createLivePoller(refresh, {
      intervalMs: INTERVAL,
      maxIntervalMs: MAX,
      idleMs,
    })
    poller.start()
    return poller
  }

  it('does not poll until the base interval elapses', async () => {
    const refresh = vi.fn(() => false)
    setup(refresh)

    await vi.advanceTimersByTimeAsync(INTERVAL - 1)
    expect(refresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('doubles the cadence while refresh reports no change, up to the cap', async () => {
    const refresh = vi.fn(() => false)
    setup(refresh, 10 * 60_000)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(refresh).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(4 * INTERVAL)
    expect(refresh).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(8 * INTERVAL)
    expect(refresh).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(MAX)
    expect(refresh).toHaveBeenCalledTimes(5)

    await vi.advanceTimersByTimeAsync(MAX)
    expect(refresh).toHaveBeenCalledTimes(6)
  })

  it('resets to the base interval once refresh reports a change', async () => {
    const refresh = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)

    setup(refresh)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    await vi.advanceTimersByTimeAsync(2 * INTERVAL)
    await vi.advanceTimersByTimeAsync(4 * INTERVAL)
    expect(refresh).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(refresh).toHaveBeenCalledTimes(4)
  })

  it('skips ticks while the tab is hidden and polls immediately on return', async () => {
    const refresh = vi.fn(() => false)
    const poller = setup(refresh)

    poller.setVisible(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(refresh).not.toHaveBeenCalled()

    poller.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps polling past idleMs while refresh reports changes', async () => {
    const refresh = vi.fn(() => true)
    setup(refresh)

    await vi.advanceTimersByTimeAsync(IDLE + INTERVAL)
    expect(refresh.mock.calls.length).toBeGreaterThan(1)
  })

  it('stops after idleMs of no activity and resumes on bumpActivity', async () => {
    const refresh = vi.fn(() => false)
    const poller = setup(refresh)

    await vi.advanceTimersByTimeAsync(IDLE)
    const calls = refresh.mock.calls.length
    expect(calls).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(MAX)
    expect(refresh).toHaveBeenCalledTimes(calls)

    poller.bumpActivity()
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(calls + 1)
  })

  it('does not treat activity as a reason to poll while already active', async () => {
    const refresh = vi.fn(() => false)
    const poller = setup(refresh)

    poller.bumpActivity()
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('skips ticks while suspended and resumes on the next interval, not immediately', async () => {
    const refresh = vi.fn(() => false)
    const poller = setup(refresh)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(refresh).toHaveBeenCalledTimes(1)

    poller.setSuspended(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(refresh).toHaveBeenCalledTimes(1)

    poller.setSuspended(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2 * INTERVAL)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('does not overlap an in-flight refresh', async () => {
    let resolveTick: (changed: boolean) => void = () => {}
    const refresh = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveTick = resolve
    }))
    const poller = setup(refresh)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(refresh).toHaveBeenCalledTimes(1)

    poller.setVisible(false)
    poller.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)

    resolveTick(false)
    await vi.advanceTimersByTimeAsync(0)
  })

  it('backs off on failure and reports the error until a later tick succeeds', async () => {
    const errors: unknown[] = []
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error('cursor unavailable'))
      .mockResolvedValue(false)

    const poller = createLivePoller(refresh, {
      intervalMs: INTERVAL,
      maxIntervalMs: MAX,
      idleMs: IDLE,
      onSettle(error) {
        errors.push(error)
      },
    })
    poller.start()

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(poller.lastError).toEqual(new Error('cursor unavailable'))
    expect(errors[0]).toEqual(new Error('cursor unavailable'))

    await vi.advanceTimersByTimeAsync(2 * INTERVAL)
    expect(poller.lastError).toBeNull()
    expect(errors[1]).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('toggle off disarms, toggle on polls immediately', async () => {
    const refresh = vi.fn(() => false)
    const poller = setup(refresh)

    poller.toggle()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(refresh).not.toHaveBeenCalled()
    expect(poller.enabled).toBe(false)

    poller.toggle()
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(poller.enabled).toBe(true)
  })

  it('stop prevents further ticks', async () => {
    const refresh = vi.fn(() => false)
    const poller = setup(refresh)

    poller.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(refresh).not.toHaveBeenCalled()
  })
})
