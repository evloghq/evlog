// Import from specific subpaths to avoid the barrel 'nitropack/runtime' which
// re-exports from internal/app.mjs — that file imports #nitro-internal-virtual/*
// modules that only exist inside rollup builds and crash when loaded externally
// (nitropack dev loads plugins outside the bundle via Worker threads).
import { defineNitroPlugin } from 'nitropack/runtime/internal/plugin'
import { nitroAsyncContext } from 'nitropack/runtime/internal/context'
import type { NitroApp } from 'nitropack/types'
import { createRequestLogger, getGlobalDrain, getGlobalPluginRunner, initLogger, isEnabled } from '../logger'
import { registerPrettyErrorSnippetReader } from '../shared/stack-frames'
import { readCodeSnippetFromDisk } from '../shared/pretty-error-snippet.node'
import { enrichErrorStackForDev } from '../shared/enrich-error-stack.node'
import { shouldLog, getServiceForPath, extractErrorStatus, type NitroPluginEvlogConfig } from '../nitro'
import { normalizeRedactConfig } from '../redact'
import { evlogFileConfigPlugins, flushEvlogFileConfigDrain, withEvlogFileConfig } from '../shared/fileConfig'
import { flushPendingDrains } from '../shared/shutdown'
import { resolveEvlogConfigForNitroPlugin, setActiveNitroRuntime } from '../shared/nitroConfigBridge'
import { bindStreamingResponseLifecycle, shouldDeferEmitForResponse } from '../shared/streamResponse'
import { setNitroRequestLoggerResolver } from '../shared/globalRegistry'
import type { MiddlewareLoggerOptions } from '../shared/middleware'
import { attachNitroFork } from '../shared/nitroFork'
import { startStreamServer, type StreamServerOptions } from '../stream'
import type { AuditableLogger } from '../audit'
import type { RequestLifecycleContext } from '../shared/plugin'
import type { RequestLogger, ServerEvent, TailSamplingContext, WideEvent } from '../types'
import { elapsedMs } from '../utils'
import { callEnrichAndDrain, getSafeHeaders, getResponseStatus } from './enrich-drain'

function createDeferredRequestLogger(e: ServerEvent): AuditableLogger {
  const headers = getSafeHeaders(e)
  let requestIdOverride = headers['x-request-id'] || undefined
  if (!requestIdOverride && globalThis.navigator?.userAgent === 'Cloudflare-Workers') {
    requestIdOverride = headers['cf-ray'] || undefined
  }
  return createRequestLogger({
    method: e.method,
    path: e.path,
    requestId: requestIdOverride || e.context.requestId || crypto.randomUUID(),
  }, { _deferDrain: true })
}

function forkOptions(nitroApp: NitroApp, e: ServerEvent): MiddlewareLoggerOptions {
  const waitUntilCtx = e.context.cloudflare?.context ?? e.context
  return {
    method: e.method,
    path: e.path,
    headers: getSafeHeaders(e),
    enrich: async (ctx) => {
      await nitroApp.hooks.callHook('evlog:enrich', ctx)
    },
    drain: async (ctx) => {
      await nitroApp.hooks.callHook('evlog:drain', ctx)
    },
    waitUntil: typeof waitUntilCtx?.waitUntil === 'function' ? waitUntilCtx.waitUntil.bind(waitUntilCtx) : undefined,
  }
}

function requestInfo(requestLog: RequestLogger, e: ServerEvent): RequestLifecycleContext['request'] {
  return { method: e.method, path: e.path, requestId: requestLog.getContext().requestId as string | undefined }
}

// eslint-disable-next-line max-params
async function emitWithTailSampling(
  nitroApp: NitroApp,
  requestLog: RequestLogger,
  e: ServerEvent,
  status: number,
  error?: Error,
): Promise<WideEvent | null> {
  const startTime = e.context._evlogStartTime as number | undefined
  const durationMs = startTime ? elapsedMs(startTime) : undefined

  const tailCtx: TailSamplingContext = {
    status,
    duration: durationMs,
    path: e.path,
    method: e.method,
    context: requestLog.getContext(),
    shouldKeep: false,
  }

  await nitroApp.hooks.callHook('evlog:emit:keep', tailCtx)
  const runner = getGlobalPluginRunner()
  if (runner.hasKeep) await runner.runKeep(tailCtx)

  const emittedEvent = requestLog.emit({ _forceKeep: tailCtx.shouldKeep, _durationMs: durationMs })
  if (runner.hasRequestLifecycle) {
    runner.runOnRequestFinish({
      logger: requestLog,
      request: requestInfo(requestLog, e),
      headers: getSafeHeaders(e),
      event: emittedEvent,
      status,
      durationMs: durationMs ?? 0,
      error,
    })
  }
  return emittedEvent
}

const DEFAULT_TRANSPORT_ENDPOINT = '/api/_evlog/ingest'

/**
 * The client transport endpoint answers each batch with a 204, and the client
 * events it carries are already logged on their own. A successful request to
 * it gets no request-level wide event; failures still emit.
 */
function getTransportEndpoint(config: NitroPluginEvlogConfig | undefined): string | undefined {
  if (!config?.transport?.enabled) return undefined
  return config.transport.endpoint ?? DEFAULT_TRANSPORT_ENDPOINT
}

export default defineNitroPlugin(async (nitroApp) => {
  setActiveNitroRuntime('v2')
  const evlogConfig = withEvlogFileConfig(await resolveEvlogConfigForNitroPlugin())

  const redact = normalizeRedactConfig(evlogConfig?.redact as boolean | Record<string, unknown> | undefined)
  const transportEndpoint = getTransportEndpoint(evlogConfig)

  registerPrettyErrorSnippetReader(readCodeSnippetFromDisk)
  // Only reaches a request when the app sets `experimental.asyncContext`.
  setNitroRequestLoggerResolver(() => (nitroAsyncContext.tryUse()?.event as ServerEvent | undefined)?.context.log)

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
  nitroApp.hooks.hook('close', flushEvlogFileConfigDrain)
  nitroApp.hooks.hook('close', () => flushPendingDrains())

  // When `evlog.stream` is set (or auto-on in dev), boot the mini stream
  // server and hook every drained event into it. The server runs on its
  // own ephemeral port — the user's API surface is untouched.
  const streamSetting = (evlogConfig as { stream?: boolean | StreamServerOptions } | undefined)?.stream
  if (streamSetting === true || (streamSetting && typeof streamSetting === 'object')) {
    const streamOpts: StreamServerOptions = streamSetting === true ? {} : streamSetting
    startStreamServer(streamOpts).then((server) => {
      nitroApp.hooks.hook('evlog:drain', (ctx) => {
        if (ctx?.event) server.drain(ctx)
      })
    }).catch((err) => {
      console.error('[evlog] failed to start stream server:', err)
    })
  }

  // When globally disabled, createRequestLogger returns a no-op logger — still
  // attach it so handlers can call useLogger(event) without throwing.
  if (!isEnabled()) {
    nitroApp.hooks.hook('request', (event) => {
      const e = event as ServerEvent
      e.context.log = attachNitroFork(createDeferredRequestLogger(e), () => forkOptions(nitroApp, e), false)
    })
    return
  }

  nitroApp.hooks.hook('request', (event) => {
    const e = event as ServerEvent

    // Evaluate route filtering but always create the logger so that server
    // middleware (which runs for every request) can call useLogger(event)
    // without throwing.  Filtering is enforced at emit time instead.
    e.context._evlogShouldEmit = shouldLog(e.path, evlogConfig?.include, evlogConfig?.exclude)

    e.context._evlogQuietOnSuccess = transportEndpoint !== undefined && e.path.split('?')[0] === transportEndpoint

    // Store start time for duration calculation in tail sampling
    e.context._evlogStartTime = Date.now()

    const requestLog = createDeferredRequestLogger(e)

    const routeService = getServiceForPath(e.path, evlogConfig?.routes)
    if (routeService) {
      requestLog.set({ service: routeService })
    }

    const runner = getGlobalPluginRunner()
    if (runner.hasExtendLogger) runner.applyExtendLogger(requestLog)
    if (runner.hasRequestLifecycle) {
      runner.runOnRequestStart({ logger: requestLog, request: requestInfo(requestLog, e), headers: getSafeHeaders(e) })
    }

    e.context.log = attachNitroFork(requestLog, () => forkOptions(nitroApp, e), e.context._evlogShouldEmit as boolean)
  })

  nitroApp.hooks.hook('error', async (error, { event }) => {
    const e = event as ServerEvent | undefined
    if (!e) return
    if (!e.context._evlogShouldEmit) return

    const requestLog = e.context.log as RequestLogger | undefined
    if (!requestLog) return

    e.context._evlogEmitting = true
    try {
      const err = error as Error
      void enrichErrorStackForDev(err, { pretty: evlogConfig?.pretty })
      requestLog.error(err)

      const errorStatus = extractErrorStatus(error)
      requestLog.set({ status: errorStatus })

      const emittedEvent = await emitWithTailSampling(nitroApp, requestLog, e, errorStatus, err)
      if (emittedEvent) {
        e.context._evlogEmitted = true
        void callEnrichAndDrain(nitroApp, emittedEvent, e, { deferDrain: true }).catch((err) => {
          console.error('[evlog] background enrich/drain failed:', err)
        })
      }
    } finally {
      delete e.context._evlogEmitting
    }
  })

  nitroApp.hooks.hook('afterResponse', async (event) => {
    const e = event as ServerEvent
    if (e.context._evlogEmitted || e.context._evlogEmitting || !e.context._evlogShouldEmit) return

    const requestLog = e.context.log as RequestLogger | undefined
    if (!requestLog) return

    const emitSuccessResponse = async (error?: Error) => {
      const status = getResponseStatus(e)
      if (e.context._evlogQuietOnSuccess && status < 400) return
      requestLog.set({ status })

      const emittedEvent = await emitWithTailSampling(nitroApp, requestLog, e, status, error)
      await callEnrichAndDrain(nitroApp, emittedEvent, e)
    }

    if (e.response && shouldDeferEmitForResponse(e.response)) {
      e.response = bindStreamingResponseLifecycle(e.response, async (meta) => {
        if (meta.error) {
          requestLog.error(meta.error)
        }
        await emitSuccessResponse(meta.error)
      })
      return
    }

    await emitSuccessResponse()
  })
})
