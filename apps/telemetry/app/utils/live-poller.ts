export interface LivePollerOptions {
  /** Base cadence while the cursor is moving. */
  intervalMs: number
  /** Cap for exponential backoff while the cursor is unchanged. */
  maxIntervalMs: number
  /** Stop polling after this much silence from the user. */
  idleMs: number
  /** Fired after every tick with the current error (`null` on success). */
  onSettle?: (error: unknown) => void
}

export interface LivePoller {
  readonly enabled: boolean
  readonly visible: boolean
  readonly suspended: boolean
  readonly lastError: unknown
  /** Polls may fire: enabled, visible, not suspended, and the user is not idle. */
  readonly active: boolean
  start(): void
  stop(): void
  toggle(): void
  setVisible(visible: boolean): void
  setSuspended(suspended: boolean): void
  bumpActivity(): void
}

/**
 * Whether this cursor probe should refetch payloads.
 *
 * The first probe always refreshes so an event that landed between the
 * initial render and the first tick is not swallowed. After that, only a
 * moved token refetches.
 */
export function cursorRequiresRefresh(lastId: number | null, latestId: number): boolean {
  return lastId === null || lastId !== latestId
}

export interface PayloadState {
  /** Cursor the payloads have caught up to, see {@link reflectedCursor}. */
  lastCursorId: number | null
  /** When the payloads were last refreshed. */
  refreshedAt: number
  /** A payload on screen holds a failed request, including one a filter change started. */
  failed: boolean
}

/**
 * Whether this probe should refetch payloads: the cursor moved, a payload on
 * screen failed, or the payloads are older than `maxAgeMs`. The range is a
 * sliding window, so events age out of it even when no new one lands.
 */
export function payloadsRequireRefresh(state: PayloadState, latestId: number, now: number, maxAgeMs: number): boolean {
  return state.failed
    || cursorRequiresRefresh(state.lastCursorId, latestId)
    || now - state.refreshedAt >= maxAgeMs
}

/**
 * The cursor a successful refresh has caught up to, to commit as the new
 * baseline. A memoized payload can predate `latestId`; committing the probed
 * cursor then would hide that event until the next one lands. `null` (a
 * payload is missing) keeps the next probe refreshing.
 */
export function reflectedCursor(
  latestId: number,
  payloads: ReadonlyArray<{ cursorId: number } | null | undefined>,
): number | null {
  let reflected = latestId
  for (const payload of payloads) {
    if (!payload) return null
    reflected = Math.min(reflected, payload.cursorId)
  }
  return reflected
}

/**
 * Schedules `refresh` with exponential backoff, and stops entirely once the
 * user has gone idle so an open tab does not hold a scale-to-zero database
 * awake. `refresh` should return `true` when the data it probed actually
 * changed, which resets the cadence to `intervalMs`.
 */
export function createLivePoller(
  refresh: () => Promise<boolean | void> | boolean | void,
  options: LivePollerOptions,
): LivePoller {
  let enabled = true
  let visible = true
  let suspended = false
  let lastActivity = Date.now()
  let currentInterval = options.intervalMs
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  let lastError: unknown = null
  let started = false

  function idle(): boolean {
    return Date.now() - lastActivity >= options.idleMs
  }

  function canPoll(): boolean {
    return started && enabled && visible && !suspended && !idle()
  }

  function disarm(): void {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  function arm(): void {
    disarm()
    if (!canPoll() || inFlight) return
    timer = setTimeout(() => {
      timer = undefined
      void tick()
    }, currentInterval)
  }

  async function tick(): Promise<void> {
    if (!canPoll() || inFlight) return
    inFlight = true
    try {
      const changed = await refresh()
      lastError = null
      if (changed === true) {
        currentInterval = options.intervalMs
        lastActivity = Date.now()
      } else {
        currentInterval = Math.min(currentInterval * 2, options.maxIntervalMs)
      }
    } catch (error) {
      lastError = error
      currentInterval = Math.min(currentInterval * 2, options.maxIntervalMs)
    } finally {
      options.onSettle?.(lastError)
      inFlight = false
      arm()
    }
  }

  const poller: LivePoller = {
    get enabled() {
      return enabled
    },
    get visible() {
      return visible
    },
    get suspended() {
      return suspended
    },
    get lastError() {
      return lastError
    },
    get active() {
      return canPoll()
    },
    start() {
      started = true
      lastActivity = Date.now()
      currentInterval = options.intervalMs
      arm()
    },
    stop() {
      started = false
      disarm()
    },
    toggle() {
      enabled = !enabled
      if (enabled) {
        lastActivity = Date.now()
        currentInterval = options.intervalMs
        void tick()
      } else {
        disarm()
      }
    },
    setVisible(next: boolean) {
      const becameVisible = next && !visible
      visible = next
      if (becameVisible) {
        lastActivity = Date.now()
        currentInterval = options.intervalMs
        void tick()
      } else {
        disarm()
      }
    },
    setSuspended(next: boolean) {
      const resumed = suspended && !next
      suspended = next
      if (resumed) {
        arm()
      } else if (suspended) {
        disarm()
      }
    },
    bumpActivity() {
      const wasIdle = idle()
      lastActivity = Date.now()
      if (wasIdle) {
        currentInterval = options.intervalMs
        void tick()
      }
    },
  }

  return poller
}
