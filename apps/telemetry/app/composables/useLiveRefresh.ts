import { createLivePoller, type LivePoller } from '../utils/live-poller'

export interface UseLiveRefreshOptions {
  /** Base polling cadence in ms. Default: 10_000. */
  intervalMs?: number
  /** Cap for exponential backoff while the cursor is unchanged. Default: 180_000. */
  maxIntervalMs?: number
  /** Stop polling after this much silence from the user. Default: 300_000. */
  idleMs?: number
  /**
   * Extra suspension signal: when `true` the poll is skipped (e.g. while the
   * run-detail slideover is open, so a manually sorted page doesn't shift
   * under the reader).
   */
  suspended?: Ref<boolean>
}

export interface UseLiveRefreshReturn {
  /** User-facing toggle — `false` after pressing pause. */
  enabled: Ref<boolean>
  /** Whether a poll is allowed right now (enabled + tab visible + not suspended). Idle is a poller concern, not a pause. */
  active: ComputedRef<boolean>
  /**
   * The most recent tick's failure, if any, or `null` once a later tick
   * succeeds. `refresh` itself decides what counts as a failure: Nuxt's
   * `useFetch`/`useAsyncData` `refresh()` resolves even on a failed request
   * (the error lands in its `.error` ref instead), so callers polling those
   * need to re-throw from inside `refresh` for it to surface here.
   */
  lastError: Ref<unknown>
  /** Flip the user toggle (pause/resume button). */
  toggle: () => void
}

/**
 * Polls `refresh` to keep the dashboard alive without pinning a scale-to-zero
 * database awake.
 *
 * Skips ticks while the tab is hidden, while the previous refresh is still in
 * flight, while `suspended` is set, and after `idleMs` of no user activity.
 * An unchanged cursor doubles the cadence up to `maxIntervalMs`; a change
 * resets it. Client-only: the timer starts on mount.
 *
 * `refresh` should return `true` when the probed data changed.
 */
export function useLiveRefresh(refresh: () => Promise<boolean | void> | boolean | void, options: UseLiveRefreshOptions = {}): UseLiveRefreshReturn {
  const intervalMs = options.intervalMs ?? 10_000
  const maxIntervalMs = options.maxIntervalMs ?? 180_000
  const idleMs = options.idleMs ?? 300_000
  const enabled = ref(true)
  const visible = ref(true)
  const lastError = ref<unknown>(null)

  const active = computed(() => enabled.value && visible.value && !(options.suspended?.value ?? false))

  let poller: LivePoller | undefined

  function sync() {
    if (!poller) return
    enabled.value = poller.enabled
    visible.value = poller.visible
    lastError.value = poller.lastError
  }

  function toggle() {
    poller?.toggle()
    sync()
  }

  function onVisibilityChange() {
    poller?.setVisible(document.visibilityState === 'visible')
    sync()
  }

  function onActivity() {
    poller?.bumpActivity()
    sync()
  }

  onMounted(() => {
    poller = createLivePoller(refresh, {
      intervalMs,
      maxIntervalMs,
      idleMs,
      onSettle(error) {
        lastError.value = error
      },
    })
    poller.setVisible(document.visibilityState === 'visible')
    poller.setSuspended(options.suspended?.value ?? false)
    poller.start()
    sync()

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pointerdown', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity)
    window.addEventListener('scroll', onActivity, { passive: true, capture: true })
    window.addEventListener('focus', onActivity)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pointerdown', onActivity)
    window.removeEventListener('keydown', onActivity)
    window.removeEventListener('scroll', onActivity, true)
    window.removeEventListener('focus', onActivity)
    poller?.stop()
    poller = undefined
  })

  watch(() => options.suspended?.value, (value) => {
    poller?.setSuspended(value ?? false)
    sync()
  })

  return { enabled, active, lastError, toggle }
}
