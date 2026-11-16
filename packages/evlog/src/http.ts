import type { DrainContext } from './types'
import type { DrainPipelineOptions, PipelineDrainFn } from './pipeline'
import { createDrainPipeline } from './pipeline'
import { isBrowser } from './utils'

export interface HttpDrainConfig {
  /** URL of the server ingest endpoint */
  endpoint: string
  /** Custom headers sent with each fetch request (e.g. Authorization, X-API-Key). Not applied to sendBeacon — see `useBeacon`. */
  headers?: Record<string, string>
  /** Request timeout in milliseconds. @default 5000 */
  timeout?: number
  /** Use sendBeacon when the page is hidden. @default true */
  useBeacon?: boolean
  /** Fetch credentials mode. @default 'same-origin' */
  credentials?: RequestCredentials
}

export interface HttpLogDrainOptions {
  drain: HttpDrainConfig
  /** Pipeline configuration overrides */
  pipeline?: DrainPipelineOptions<DrainContext>
  /** Auto-register visibilitychange flush listener. @default true */
  autoFlush?: boolean
}

/**
 * Create a low-level HTTP drain transport function (fetch / sendBeacon).
 *
 * Returns a function compatible with `createDrainPipeline` that sends batches
 * to the configured endpoint via `fetch` (with `keepalive: true`) or
 * `navigator.sendBeacon` when the page is hidden.
 *
 * @example
 * ```ts
 * import { createHttpDrain } from 'evlog/http'
 * import { createDrainPipeline } from 'evlog/pipeline'
 *
 * const pipeline = createDrainPipeline({ batch: { size: 50 } })
 * const drain = pipeline(createHttpDrain({ endpoint: '/api/logs' }))
 * ```
 */
export function createHttpDrain(config: HttpDrainConfig): (batch: DrainContext[]) => Promise<void> {
  const { endpoint, headers: customHeaders, timeout = 5000, useBeacon = true, credentials = 'same-origin' } = config

  return async (batch: DrainContext[]): Promise<void> => {
    if (batch.length === 0) return

    const body = JSON.stringify(batch)

    if (
      useBeacon
      && isBrowser()
      && document.visibilityState === 'hidden'
      && typeof navigator.sendBeacon === 'function'
    ) {
      const queued = navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))
      if (!queued) {
        throw new Error('[evlog/http] sendBeacon failed — payload may exceed browser limit')
      }
      return
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Evlog-Source': 'client', ...customHeaders },
        body,
        signal: controller.signal,
        keepalive: true,
        credentials,
      })

      if (!response.ok) {
        throw new Error(`[evlog/http] Server responded with ${response.status}`)
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * Create a pre-composed HTTP log drain with pipeline, batching, and auto-flush.
 *
 * Returns a `PipelineDrainFn<DrainContext>` directly usable with `initLogger({ drain })`.
 *
 * @example
 * ```ts
 * import { initLogger, log } from 'evlog'
 * import { createHttpLogDrain } from 'evlog/http'
 *
 * const drain = createHttpLogDrain({
 *   drain: { endpoint: '/api/logs' },
 * })
 * initLogger({ drain })
 *
 * log.info({ action: 'page_view', path: location.pathname })
 * ```
 */
export function createHttpLogDrain(options: HttpLogDrainOptions): PipelineDrainFn<DrainContext> & { dispose: () => void } {
  const { autoFlush = true } = options

  const pipeline = createDrainPipeline<DrainContext>({
    batch: { size: 25, intervalMs: 2000 },
    retry: { maxAttempts: 2 },
    ...options.pipeline,
  })

  const drain = pipeline(createHttpDrain(options.drain)) as PipelineDrainFn<DrainContext> & { dispose: () => void }

  let onVisibilityChange: (() => void) | undefined

  if (autoFlush && isBrowser()) {
    onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        drain.flush()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  drain.dispose = () => {
    if (onVisibilityChange) {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      onVisibilityChange = undefined
    }
  }

  return drain
}
