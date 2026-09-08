import type { DrainContext, EnrichContext, RedactConfig, RequestLogger, RouteConfig, TailSamplingContext, WideEvent } from '../types'
import type { AuditableLogger } from '../audit'
import { createRequestLogger, getGlobalDrain, getGlobalPluginRunner, isEnabled, markWideEventDrainStarted, noopLogger, shouldKeep } from '../logger'
import { isGloballyRedacted, redactEvent, resolveRedactConfig } from '../redact'
import { elapsedMs } from '../utils'
import { extractErrorStatus } from './errors'
import type { EvlogPlugin, PluginRunner } from './plugin'
import { createPluginRunner, getEmptyPluginRunner } from './plugin'
import { shouldLog, getServiceForPath } from './routes'
import { extendDeferredDrain } from './deferred-drain'
import { hasWideEventPublisher, publishWideEvent } from './wideEventChannel'
import { bindStreamingResponseLifecycle, shouldDeferEmitForResponse } from './streamResponse'

/**
 * Base options shared by every framework integration. Re-exported via
 * `evlog/toolkit` so custom integrations can extend it.
 */
export interface BaseEvlogOptions {
  /** Route glob patterns to include. If unset, all routes are logged. */
  include?: string[]
  /** Route glob patterns to exclude. Takes precedence over `include`. */
  exclude?: string[]
  /** Per-route service overrides. */
  routes?: Record<string, RouteConfig>
  /** Drain callback invoked with every emitted event. */
  drain?: (ctx: DrainContext) => void | Promise<void>
  /** Enrich callback invoked after emit, before drain. */
  enrich?: (ctx: EnrichContext) => void | Promise<void>
  /** Tail sampling callback. Set `ctx.shouldKeep = true` to force-keep. */
  keep?: (ctx: TailSamplingContext) => void | Promise<void>
  /**
   * PII auto-redaction. `true` enables built-in patterns; pass an object for
   * fine-grained control. Applied before enrich/drain.
   */
  redact?: boolean | RedactConfig
  /** Plugins for this middleware, merged with globally-registered ones. */
  plugins?: EvlogPlugin[]
  /**
   * Serverless runtime hook (Cloudflare Workers `ExecutionContext#waitUntil`,
   * Vercel Edge `@vercel/functions`, …). When set, enrich still runs before the
   * response returns but drain work is registered with `waitUntil` instead of
   * being awaited — same behavior as `evlog/workers` and the Nitro plugin.
   *
   * Pass a bound method per request, e.g. `ctx.waitUntil.bind(ctx)`.
   */
  waitUntil?: (promise: Promise<unknown>) => void
}

/**
 * Project any superset of {@link BaseEvlogOptions} onto just the middleware
 * surface, dropping caller-specific extras.
 *
 * This is the single place listing the {@link BaseEvlogOptions} fields — adding
 * an option here makes it flow through `defineEvlog()` and every integration
 * that builds middleware options from its own richer option type.
 */
export function pickBaseEvlogOptions(options: BaseEvlogOptions): BaseEvlogOptions {
  const out: BaseEvlogOptions = {}
  if (options.include) out.include = options.include
  if (options.exclude) out.exclude = options.exclude
  if (options.routes) out.routes = options.routes
  if (options.drain) out.drain = options.drain
  if (options.enrich) out.enrich = options.enrich
  if (options.keep) out.keep = options.keep
  if (options.redact !== undefined) out.redact = options.redact
  if (options.plugins) out.plugins = options.plugins
  if (options.waitUntil) out.waitUntil = options.waitUntil
  return out
}

/** Internal options accepted by `createMiddlewareLogger`. */
export interface MiddlewareLoggerOptions extends BaseEvlogOptions {
  method: string
  path: string
  requestId?: string
  /** Pre-filtered safe request headers used for enrich/drain context. */
  headers?: Record<string, string>
}

export interface MiddlewareLoggerResult {
  logger: AuditableLogger
  finish: (opts?: { status?: number; error?: Error }) => Promise<WideEvent | null>
  /**
   * Finish request logging, deferring emit until a streaming response body completes.
   * Returns the original response or a wrapped copy when the body is a stream.
   */
  finishResponse: (response: Response, opts?: { status?: number }) => Promise<Response>
  skipped: boolean
}

const noopResult: MiddlewareLoggerResult = {
  logger: noopLogger,
  finish: () => Promise.resolve(null),
  finishResponse: (response) => Promise.resolve(response),
  skipped: true,
}

// Memoizes the merged runner per local plugins array (stable across requests
// because it lives in the middleware factory closure). Invalidated when
// `initLogger` swaps the global runner, so the merge cost is paid once.
const runnerCache = new WeakMap<EvlogPlugin[], { global: PluginRunner; merged: PluginRunner }>()

/**
 * Resolve the plugin runner for a middleware invocation by merging local
 * plugins with the globally-registered ones (deduplicated by `name`).
 */
export function resolveMiddlewarePluginRunner(options: { plugins?: EvlogPlugin[] }): PluginRunner {
  const global = getGlobalPluginRunner()
  const local = options.plugins
  if (!local || local.length === 0) return global

  const cached = runnerCache.get(local)
  if (cached && cached.global === global) return cached.merged

  const merged = new Map<string, EvlogPlugin>()
  for (const plugin of global.plugins) merged.set(plugin.name, plugin)
  for (const plugin of local) merged.set(plugin.name, plugin)
  if (merged.size === 0) return getEmptyPluginRunner()

  const runner = createPluginRunner(Array.from(merged.values()))
  runnerCache.set(local, { global, merged: runner })
  return runner
}

/** Copy redacted fields onto the emitted event without replacing its identity. */
function assignRedactedEvent(target: WideEvent, redacted: Partial<WideEvent>): void {
  for (const key of Object.keys(target) as Array<keyof WideEvent>) {
    if (!(key in redacted)) {
      delete target[key]
    }
  }
  Object.assign(target, redacted)
}

/**
 * Apply redact, enrich, and drain to an emitted wide event — the same
 * pipeline used by {@link createMiddlewareLogger}'s `finish`.
 */
// eslint-disable-next-line max-params
export async function runEnrichAndDrain(
  emittedEvent: WideEvent,
  options: MiddlewareLoggerOptions,
  requestInfo: { method: string; path: string; requestId?: string },
  responseStatus?: number,
  plugins?: PluginRunner,
): Promise<void> {
  const runner = plugins ?? resolveMiddlewarePluginRunner(options)
  const resolvedRedact = resolveRedactConfig(options.redact)
  if (resolvedRedact && !isGloballyRedacted(emittedEvent)) {
    assignRedactedEvent(emittedEvent, redactEvent(emittedEvent, resolvedRedact) as Partial<WideEvent>)
  }

  if (options.enrich || runner.hasEnrich) {
    const enrichCtx: EnrichContext = {
      event: emittedEvent,
      request: requestInfo,
      headers: options.headers,
      response: { status: responseStatus },
    }
    if (options.enrich) {
      try {
        await options.enrich(enrichCtx)
      } catch (err) {
        console.error('[evlog] enrich failed:', err)
      }
    }
    if (runner.hasEnrich) {
      await runner.runEnrich(enrichCtx)
    }
  }

  publishWideEvent(emittedEvent)
  markWideEventDrainStarted(emittedEvent)

  const drain = options.drain ?? getGlobalDrain()
  const hasUserDrain = !!drain
  const hasPluginDrain = runner.hasDrain
  if (hasUserDrain || hasPluginDrain) {
    const drainCtx: DrainContext = {
      event: emittedEvent,
      request: requestInfo,
      headers: options.headers,
    }
    const tasks: Array<Promise<unknown>> = []
    if (hasUserDrain) {
      tasks.push(
        (async () => {
          try {
            await drain!(drainCtx)
          } catch (err) {
            console.error('[evlog] drain failed:', err)
          }
        })(),
      )
    }
    if (hasPluginDrain) {
      tasks.push(runner.runDrain(drainCtx))
    }
    const drainPromise = Promise.all(tasks)
    if (options.waitUntil) {
      extendDeferredDrain(drainPromise, options.waitUntil)
      // A pipeline drain buffers and returns immediately; extend the runtime's
      // lifetime until the buffered batch is delivered, not just until push().
      if (hasUserDrain) {
        const { settled } = drain as { settled?: () => Promise<void> }
        if (typeof settled === 'function') {
          extendDeferredDrain(settled(), options.waitUntil)
        }
      }
      return
    }
    await drainPromise
  }
}

/**
 * Create a request logger with the full middleware pipeline: route filtering,
 * service overrides, duration tracking, tail sampling, emit, enrich, drain.
 *
 * Framework adapters extract method/path/requestId/headers, call this once
 * per request, and call `finish({ status | error })` when the response ends.
 * If `skipped` is `true`, the route was filtered out — bypass logging.
 */
export function createMiddlewareLogger(options: MiddlewareLoggerOptions): MiddlewareLoggerResult {
  if (!isEnabled()) return noopResult

  const { method, path, requestId, include, exclude, routes, keep } = options

  if (!shouldLog(path, include, exclude)) {
    return noopResult
  }

  const resolvedRequestId = requestId || crypto.randomUUID()

  const logger = createRequestLogger({
    method,
    path,
    requestId: resolvedRequestId,
  }, { _deferDrain: true })

  const routeService = getServiceForPath(path, routes)
  if (routeService) {
    logger.set({ service: routeService })
  }

  const pluginRunner = resolveMiddlewarePluginRunner(options)
  if (pluginRunner.hasExtendLogger) {
    pluginRunner.applyExtendLogger(logger)
  }

  const startTime = Date.now()
  const requestInfo = { method, path, requestId: resolvedRequestId }

  if (pluginRunner.hasRequestLifecycle) {
    pluginRunner.runOnRequestStart({
      logger,
      request: requestInfo,
      headers: options.headers,
    })
  }

  const finish = (opts?: { status?: number; error?: Error }): Promise<WideEvent | null> => {
    return performFinish(logger, opts)
  }

  const finishResponse = async (response: Response, opts?: { status?: number }): Promise<Response> => {
    const status = opts?.status ?? response.status
    if (!shouldDeferEmitForResponse(response)) {
      await performFinish(logger, { status })
      return response
    }

    return bindStreamingResponseLifecycle(response, async (meta) => {
      await performFinish(logger, {
        status: meta.status ?? status,
        error: meta.error,
      })
    })
  }

  async function performFinish(
    requestLogger: RequestLogger,
    opts?: { status?: number; error?: Error },
  ): Promise<WideEvent | null> {
    const { status, error } = opts ?? {}

    if (error) {
      requestLogger.error(error)
      const errorStatus = extractErrorStatus(error)
      requestLogger.set({ status: errorStatus })
    } else if (status !== undefined) {
      requestLogger.set({ status })
    }

    const durationMs = elapsedMs(startTime)

    const resolvedStatus = error
      ? extractErrorStatus(error)
      : status ?? (requestLogger.getContext().status as number | undefined)

    const tailCtx: TailSamplingContext = {
      status: resolvedStatus,
      duration: durationMs,
      path,
      method,
      context: requestLogger.getContext(),
      shouldKeep: false,
    }

    if (keep) {
      await keep(tailCtx)
    }
    if (pluginRunner.hasKeep) {
      await pluginRunner.runKeep(tailCtx)
    }

    const forceKeep = tailCtx.shouldKeep || shouldKeep(tailCtx)
    const emittedEvent = requestLogger.emit({ _forceKeep: forceKeep })

    if (
      emittedEvent
      && (options.enrich || options.drain || pluginRunner.hasEnrich || pluginRunner.hasDrain || getGlobalDrain() || hasWideEventPublisher())
    ) {
      await runEnrichAndDrain(emittedEvent, options, requestInfo, resolvedStatus, pluginRunner)
    }

    if (pluginRunner.hasRequestLifecycle) {
      pluginRunner.runOnRequestFinish({
        logger: requestLogger,
        request: requestInfo,
        headers: options.headers,
        event: emittedEvent,
        status: resolvedStatus,
        durationMs,
        error,
      })
    }

    return emittedEvent
  }

  return { logger, finish, finishResponse, skipped: false }
}
