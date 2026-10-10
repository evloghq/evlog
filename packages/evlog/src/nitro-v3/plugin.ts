import { definePlugin } from 'nitro'
import type { CaptureError } from 'nitro/types'
import type { HTTPEvent } from 'nitro/h3'
import { parseURL } from 'ufo'
import { createRequestLogger, getGlobalPluginRunner, initLogger, isEnabled, markWideEventDrainStarted, outputWideEvent } from '../logger'
import { registerPrettyErrorSnippetReader } from '../shared/pretty-error'
import { readCodeSnippetFromDisk } from '../shared/pretty-error-snippet.node'
import { enrichErrorStackForDev } from '../shared/enrich-error-stack.node'
import { shouldLog, getServiceForPath, extractErrorStatus } from '../nitro'
import { extendDeferredDrain } from '../nitro/deferred-drain'
import { normalizeRedactConfig } from '../redact'
import { evlogFileConfigPlugins, flushEvlogFileConfigDrain, withEvlogFileConfig } from '../shared/fileConfig'
import { resolveEvlogConfigForNitroPlugin, setActiveNitroRuntime } from '../shared/nitroConfigBridge'
import type { EnrichContext, RequestLogger, TailSamplingContext, WideEvent } from '../types'
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
  'evlog:drain': (ctx: { event: WideEvent; request?: { method?: string; path: string; requestId?: string }; headers?: Record<string, string> }) => void | Promise<void>
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
  let requestIdOverride: string | undefined
  if (globalThis.navigator?.userAgent === 'Cloudflare-Workers') {
    const cfRay = event.req.headers.get('cf-ray')
    if (cfRay) requestIdOverride = cfRay
  }
  return requestIdOverride || ctx.requestId as string | undefined || crypto.randomUUID()
}

// eslint-disable-next-line max-params
async function emitWithTailSampling(
  hooks: Hooks,
  log: RequestLogger,
  event: HTTPEvent,
  status: number,
  ctx: Record<string, unknown>,
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

  return log.emit({ _forceKeep: tailCtx.shouldKeep, _durationMs: durationMs })
}

function getSafeRequestHeaders(event: HTTPEvent): Record<string, string> {
  const headers: Record<string, string> = {}
  event.req.headers.forEach((value, key) => {
    headers[key] = value
  })
  return filterSafeHeaders(headers)
}

function getSafeResponseHeaders(res: Response): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    headers[key] = value
  })
  if (Object.keys(headers).length === 0) return undefined
  return filterSafeHeaders(headers)
}

function buildHookContext(
  event: HTTPEvent,
  res?: Response,
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
  res?: Response,
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
 * export { default } from 'evlog/nitro/v3'
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
    plugins: evlogFileConfigPlugins(),
    _suppressDrainWarning: true,
  })

  const hooks = nitroApp.hooks as unknown as Hooks
  hooks.hook('close', flushEvlogFileConfigDrain)

  // When globally disabled, createRequestLogger returns a no-op logger — still
  // attach it so handlers can call useLogger without throwing.
  if (!isEnabled()) {
    hooks.hook('request', (event) => {
      const { pathname } = parseURL(event.req.url)
      const ctx = getContext(event)
      ctx.log = createRequestLogger({
        method: event.req.method,
        path: pathname,
        requestId: resolveRequestId(event, ctx),
      }, { _deferDrain: true })
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

    const log = createRequestLogger({
      method: event.req.method,
      path: pathname,
      requestId: resolveRequestId(event, ctx),
    }, { _deferDrain: true })

    // Apply route-based service configuration if a matching route is found
    const routeService = getServiceForPath(pathname, evlogConfig?.routes)
    if (routeService) {
      log.set({ service: routeService })
    }

    ctx.log = log
  })

  hooks.hook('response', async (res, event) => {
    const ctx = event.req.context
    // Skip if already emitted by error hook or route was filtered out
    if (ctx?._evlogEmitted || ctx?._evlogEmitting || !ctx?._evlogShouldEmit) return

    const log = ctx.log as RequestLogger | undefined
    if (!log) return

    const emitSuccessResponse = async (responseStatus: number) => {
      log.set({ status: responseStatus })
      const emittedEvent = await emitWithTailSampling(hooks, log, event, responseStatus, ctx)
      await callEnrichAndDrain(hooks, emittedEvent, event, res)
    }

    // Streaming responses (SSE, NDJSON, chunked) emit at header time: h3 v2's
    // `onResponse` hook cannot swap the outgoing response (`H3Event.res` is a
    // getter-only accessor, and `toResponse` sends the original response no
    // matter what the hook does), so wrapping the body here would only lock the
    // original stream and break the response. Stream-lifetime metrics are not
    // observable from this hook.
    await emitSuccessResponse(res.status)
  })

  hooks.hook('error', async (error, { event }) => {
    if (!event) return
    const e = event as HTTPEvent

    const ctx = e.req.context
    if (!ctx?._evlogShouldEmit) return
    const log = ctx.log as RequestLogger | undefined
    if (!log) return

    ctx._evlogEmitting = true
    try {
      const actualError = (error.cause as Error)?.name === 'EvlogError'
        ? error.cause as Error
        : error as Error

      void enrichErrorStackForDev(actualError, { pretty: evlogConfig?.pretty })
      log.error(actualError)

      const errorStatus = extractErrorStatus(actualError)
      log.set({ status: errorStatus })

      const emittedEvent = await emitWithTailSampling(hooks, log, e, errorStatus, ctx)
      if (emittedEvent) {
        ctx._evlogEmitted = true
        void callEnrichAndDrain(hooks, emittedEvent, e, undefined, { deferDrain: true }).catch((err) => {
          console.error('[evlog] background enrich/drain failed:', err)
        })
      }
    } finally {
      delete ctx._evlogEmitting
    }
  })
})
