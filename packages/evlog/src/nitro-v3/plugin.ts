import { definePlugin } from 'nitro'
import { useRequest } from 'nitro/context'
import type { CaptureError } from 'nitro/types'
import type { HTTPEvent } from 'nitro/h3'
import * as h3 from 'nitro/h3'
import { parseURL } from 'ufo'
import { createRequestLogger, getGlobalDrain, getGlobalPluginRunner, initLogger, isEnabled, markWideEventDrainStarted, outputWideEvent } from '../logger'
import { registerPrettyErrorSnippetReader } from '../shared/stack-frames'
import { readCodeSnippetFromDisk } from '../shared/pretty-error-snippet.node'
import { enrichErrorStackForDev } from '../shared/enrich-error-stack.node'
import { shouldLog, getServiceForPath, extractErrorStatus } from '../nitro'
import { extendDeferredDrain } from '../nitro/deferred-drain'
import { normalizeRedactConfig } from '../redact'
import { shouldDeferEmitForResponse } from '../shared/streamResponse'
import { evlogFileConfigPlugins, flushEvlogFileConfigDrain, withEvlogFileConfig } from '../shared/fileConfig'
import { flushPendingDrains } from '../shared/shutdown'
import { resolveEvlogConfigForNitroPlugin, setActiveNitroRuntime } from '../shared/nitroConfigBridge'
import { setNitroRequestLoggerResolver } from '../shared/globalRegistry'
import type { MiddlewareLoggerOptions } from '../shared/middleware'
import { attachNitroFork } from '../shared/nitroFork'
import type { DrainContext, EnrichContext, RequestLogger, TailSamplingContext, WideEvent } from '../types'
import { elapsedMs, filterSafeHeaders } from '../utils'

// Nitro v3 doesn't fully export hook types yet
// https://github.com/nitrojs/nitro/blob/8882bc9e1dbf2d342e73097f22a2156f70f50575/src/types/runtime/nitro.ts#L48-L53
interface NitroV3Hooks {
  close: () => void
  error: CaptureError
  request: (event: HTTPEvent) => void | Promise<void>
  response: (res: Response, event: HTTPEvent) => void | Promise<void>
  'evlog:emit:keep': (ctx: TailSamplingContext) => void | Promise<void>
  'evlog:enrich': (ctx: EnrichContext) => void | Promise<void>
  'evlog:drain': (ctx: DrainContext) => void | Promise<void>
}

type Hooks = {
  hook: <T extends keyof NitroV3Hooks>(name: T, listener: NitroV3Hooks[T]) => void
  callHook: <T extends keyof NitroV3Hooks>(name: T, ...args: Parameters<NitroV3Hooks[T]>) => Promise<void>
}

function getContext(event: HTTPEvent): Record<string, unknown> {
  if (!event.req.context) {
    event.req.context = {}
  }
  return event.req.context
}

function resolveRequestId(event: HTTPEvent, ctx: Record<string, unknown>): string {
  let requestIdOverride = event.req.headers.get('x-request-id') || undefined
  if (!requestIdOverride && globalThis.navigator?.userAgent === 'Cloudflare-Workers') {
    requestIdOverride = event.req.headers.get('cf-ray') || undefined
  }
  return requestIdOverride || ctx.requestId as string | undefined || crypto.randomUUID()
}

function forkOptions(hooks: Hooks, event: HTTPEvent): MiddlewareLoggerOptions {
  return {
    method: event.req.method,
    path: parseURL(event.req.url).pathname,
    headers: getSafeRequestHeaders(event),
    enrich: async (ctx) => {
      await hooks.callHook('evlog:enrich', ctx)
    },
    drain: async (ctx) => {
      await hooks.callHook('evlog:drain', ctx)
    },
    waitUntil: typeof event.req.waitUntil === 'function' ? event.req.waitUntil.bind(event.req) : undefined,
  }
}

/** The request logger of the request Nitro's async context holds; `useRequest()` throws without one. */
function currentRequestLogger(): unknown {
  try {
    return (useRequest() as { context?: Record<string, unknown> }).context?.log
  } catch {
    return undefined
  }
}

// eslint-disable-next-line max-params
async function emitWithTailSampling(
  hooks: Hooks,
  log: RequestLogger,
  event: HTTPEvent,
  status: number,
  ctx: Record<string, unknown>,
  error?: Error,
): Promise<WideEvent | null> {
  const startTime = ctx._evlogStartTime as number | undefined
  const durationMs = startTime ? elapsedMs(startTime) : undefined

  const { pathname } = parseURL(event.req.url)
  const tailCtx: TailSamplingContext = {
    status,
    duration: durationMs,
    path: pathname,
    method: event.req.method,
    context: log.getContext(),
    shouldKeep: false,
  }

  await hooks.callHook('evlog:emit:keep', tailCtx)
  const runner = getGlobalPluginRunner()
  if (runner.hasKeep) await runner.runKeep(tailCtx)

  const emittedEvent = log.emit({ _forceKeep: tailCtx.shouldKeep, _durationMs: durationMs })
  ctx._evlogEmitted = true
  if (runner.hasRequestLifecycle) {
    runner.runOnRequestFinish({
      logger: log,
      request: { method: event.req.method, path: pathname, requestId: log.getContext().requestId as string | undefined },
      headers: getSafeRequestHeaders(event),
      event: emittedEvent,
      status,
      durationMs: durationMs ?? 0,
      error,
    })
  }
  return emittedEvent
}

function getSafeRequestHeaders(event: HTTPEvent): Record<string, string> {
  const headers: Record<string, string> = {}
  event.req.headers.forEach((value, key) => {
    headers[key] = value
  })
  return filterSafeHeaders(headers)
}

/** The status and headers a response was sent with, read before the body is sent. */
type SentResponse = Pick<Response, 'status' | 'headers'>

function getSafeResponseHeaders(res: SentResponse): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    headers[key] = value
  })
  if (Object.keys(headers).length === 0) return undefined
  return filterSafeHeaders(headers)
}

function buildHookContext(
  event: HTTPEvent,
  res?: SentResponse,
): Omit<EnrichContext, 'event'> {
  const { pathname } = parseURL(event.req.url)
  const responseHeaders = res ? getSafeResponseHeaders(res) : undefined
  return {
    request: { method: event.req.method, path: pathname },
    headers: getSafeRequestHeaders(event),
    response: {
      status: res?.status ?? 200,
      headers: responseHeaders,
    },
  }
}

// eslint-disable-next-line max-params
async function callDrainHook(
  hooks: Hooks,
  emittedEvent: WideEvent | null,
  event: HTTPEvent,
  hookContext: Omit<EnrichContext, 'event'>,
  options?: { deferDrain?: boolean },
): Promise<void> {
  if (!emittedEvent) return

  const drainCtx = {
    event: emittedEvent,
    request: hookContext.request,
    headers: hookContext.headers,
  }

  const drainTasks: Array<Promise<unknown>> = []
  try {
    const result = hooks.callHook('evlog:drain', drainCtx)
    if (result?.catch) {
      drainTasks.push(
        result.catch((err: unknown) => {
          console.error('[evlog] drain failed:', err)
        }),
      )
    }
  } catch (err) {
    console.error('[evlog] drain failed:', err)
  }

  const runner = getGlobalPluginRunner()
  if (runner.hasDrain) {
    drainTasks.push(runner.runDrain(drainCtx))
  }

  if (drainTasks.length === 0) return
  const drainPromise = Promise.all(drainTasks)

  // deferDrain: never block Nitro Node responses; extend lifetime on Cloudflare only.
  if (options?.deferDrain) {
    const waitUntil = globalThis.navigator?.userAgent === 'Cloudflare-Workers' && typeof event.req.waitUntil === 'function'
      ? event.req.waitUntil.bind(event.req)
      : undefined
    extendDeferredDrain(drainPromise, waitUntil)
    return
  }

  if (typeof event.req.waitUntil === 'function') {
    event.req.waitUntil(drainPromise)
  } else {
    await drainPromise
  }
}

// eslint-disable-next-line max-params
async function callEnrichAndDrain(
  hooks: Hooks,
  emittedEvent: WideEvent | null,
  event: HTTPEvent,
  res?: SentResponse,
  options?: { deferDrain?: boolean },
): Promise<void> {
  if (!emittedEvent) return

  const hookContext = buildHookContext(event, res)
  const enrichCtx: EnrichContext = { event: emittedEvent, ...hookContext }

  try {
    await hooks.callHook('evlog:enrich', enrichCtx)
  } catch (err) {
    console.error('[evlog] enrich failed:', err)
  }

  const runner = getGlobalPluginRunner()
  if (runner.hasEnrich) {
    await runner.runEnrich(enrichCtx)
  }

  outputWideEvent(emittedEvent)
  markWideEventDrainStarted(emittedEvent)

  await callDrainHook(hooks, emittedEvent, event, hookContext, options)
}

/**
 * Nitro v3 plugin entry point.
 *
 * Usage in Nitro v3:
 * ```ts
 * // plugins/evlog.ts
 * export { default } from 'evlog/nitro'
 * ```
 */
export default definePlugin(async (nitroApp) => {
  setActiveNitroRuntime('v3')
  const evlogConfig = withEvlogFileConfig(await resolveEvlogConfigForNitroPlugin())

  const redact = normalizeRedactConfig(evlogConfig?.redact as boolean | Record<string, unknown> | undefined)

  registerPrettyErrorSnippetReader(readCodeSnippetFromDisk)

  initLogger({
    enabled: evlogConfig?.enabled,
    env: evlogConfig?.env,
    pretty: evlogConfig?.pretty,
    dev: evlogConfig?.dev,
    silent: evlogConfig?.silent,
    sampling: evlogConfig?.sampling,
    minLevel: evlogConfig?.minLevel,
    stringify: evlogConfig?.stringify,
    redact,
    // Nitro does not await plugins, so a plugin that ran before this one settled
    // may already have set a drain; `initLogger` would clear it.
    drain: getGlobalDrain(),
    plugins: evlogFileConfigPlugins(),
    _suppressDrainWarning: true,
  })

  const hooks = nitroApp.hooks as unknown as Hooks
  hooks.hook('close', flushEvlogFileConfigDrain)
  hooks.hook('close', () => flushPendingDrains())
  // Only reaches a request when the app sets `experimental.asyncContext`.
  setNitroRequestLoggerResolver(currentRequestLogger)

  // When globally disabled, createRequestLogger returns a no-op logger — still
  // attach it so handlers can call useLogger without throwing.
  if (!isEnabled()) {
    hooks.hook('request', (event) => {
      const { pathname } = parseURL(event.req.url)
      const ctx = getContext(event)
      ctx.log = attachNitroFork(createRequestLogger({
        method: event.req.method,
        path: pathname,
        requestId: resolveRequestId(event, ctx),
      }, { _deferDrain: true }), () => forkOptions(hooks, event), false)
    })
    return
  }

  hooks.hook('request', (event) => {
    const { pathname } = parseURL(event.req.url)
    const ctx = getContext(event)

    // Evaluate route filtering but always create the logger so that server
    // middleware (which runs for every request) can call useLogger(event)
    // without throwing.  Filtering is enforced at emit time instead.
    ctx._evlogShouldEmit = shouldLog(pathname, evlogConfig?.include, evlogConfig?.exclude)

    // Store start time for duration calculation in tail sampling
    ctx._evlogStartTime = Date.now()

    const requestId = resolveRequestId(event, ctx)
    const log = createRequestLogger({
      method: event.req.method,
      path: pathname,
      requestId,
    }, { _deferDrain: true })

    const routeService = getServiceForPath(pathname, evlogConfig?.routes)
    if (routeService) {
      log.set({ service: routeService })
    }

    const runner = getGlobalPluginRunner()
    if (runner.hasExtendLogger) runner.applyExtendLogger(log)
    if (runner.hasRequestLifecycle) {
      runner.runOnRequestStart({
        logger: log,
        request: { method: event.req.method, path: pathname, requestId },
        headers: getSafeRequestHeaders(event),
      })
    }

    ctx.log = attachNitroFork(log, () => forkOptions(hooks, event), ctx._evlogShouldEmit as boolean)
  })

  const recordError = (log: RequestLogger, error: Error): Error => {
    const actualError = (error.cause as Error)?.name === 'EvlogError'
      ? error.cause as Error
      : error

    void enrichErrorStackForDev(actualError, { pretty: evlogConfig?.pretty })
    log.error(actualError)
    return actualError
  }

  hooks.hook('response', async (res, event) => {
    const ctx = event.req.context
    // Skip if already emitted by error hook or route was filtered out
    if (ctx?._evlogEmitted || ctx?._evlogEmitting || !ctx?._evlogShouldEmit) return

    const log = ctx.log as RequestLogger | undefined
    if (!log) return

    const captured = ctx.nitro?.errors?.at(-1)?.error
    const recorded = captured ? recordError(log, captured) : undefined

    // Nitro does not await error hooks, so an earlier async hook can delay ours.
    ctx._evlogEmitting = true
    const emit = async (sent: SentResponse) => {
      try {
        log.set({ status: sent.status })
        const emittedEvent = await emitWithTailSampling(hooks, log, event, sent.status, ctx, recorded)
        await callEnrichAndDrain(hooks, emittedEvent, event, sent)
      } finally {
        delete ctx._evlogEmitting
      }
    }

    // A streamed body emits once it ends or the client leaves; `_evlogEmitting` stays set so a
    // mid-stream error is recorded, not emitted. h3 before 2.0.1 has no `onDispose`: header-time emit.
    if ('onDispose' in h3 && shouldDeferEmitForResponse(res)) {
      // srvx's Node response drops its status and headers once sent: copy them now.
      const sent = { status: res.status, headers: new Headers(res.headers) }
      h3.onDispose(event, () => emit(sent))
      return
    }

    await emit(res)
  })

  hooks.hook('error', async (error, { event }) => {
    if (!event) return
    const e = event as HTTPEvent

    const ctx = e.req.context
    if (!ctx?._evlogShouldEmit) return
    const log = ctx.log as RequestLogger | undefined
    if (!log || ctx._evlogEmitted) return

    // A delayed hook must not replace a newer error already captured for this request.
    const errors = ctx.nitro?.errors
    if (ctx._evlogEmitting && errors?.some(entry => entry.error === error) && errors.at(-1)?.error !== error) return

    const actualError = recordError(log, error)
    if (ctx._evlogEmitting) return

    ctx._evlogEmitting = true
    try {
      const errorStatus = extractErrorStatus(actualError)
      log.set({ status: errorStatus })

      const emittedEvent = await emitWithTailSampling(hooks, log, e, errorStatus, ctx, actualError)
      if (emittedEvent) {
        void callEnrichAndDrain(hooks, emittedEvent, e, undefined, { deferDrain: true }).catch((err) => {
          console.error('[evlog] background enrich/drain failed:', err)
        })
      }
    } finally {
      delete ctx._evlogEmitting
    }
  })
})
