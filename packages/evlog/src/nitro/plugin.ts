// Import from specific subpaths to avoid the barrel 'nitropack/runtime' which
// re-exports from internal/app.mjs — that file imports #nitro-internal-virtual/*
// modules that only exist inside rollup builds and crash when loaded externally
// (nitropack dev loads plugins outside the bundle via Worker threads).
import { defineNitroPlugin } from 'nitropack/runtime/internal/plugin'
import type { NitroApp } from 'nitropack/types'
import { createRequestLogger, getGlobalPluginRunner, initLogger, isEnabled } from '../logger'
import { registerPrettyErrorSnippetReader } from '../shared/pretty-error'
import { readCodeSnippetFromDisk } from '../shared/pretty-error-snippet.node'
import { enrichErrorStackForDev } from '../shared/enrich-error-stack.node'
import { shouldLog, getServiceForPath, extractErrorStatus } from '../nitro'
import { normalizeRedactConfig } from '../redact'
import { resolveEvlogConfigForNitroPlugin, setActiveNitroRuntime } from '../shared/nitroConfigBridge'
import { bindStreamingResponseLifecycle, shouldDeferEmitForResponse } from '../shared/streamResponse'
import { startStreamServer, type StreamServerOptions } from '../stream'
import type { RequestLogger, ServerEvent, TailSamplingContext, WideEvent } from '../types'
import { elapsedMs } from '../utils'
import { callEnrichAndDrain, getSafeHeaders, getResponseStatus } from './enrich-drain'

function createDeferredRequestLogger(e: ServerEvent): RequestLogger {
  let requestIdOverride: string | undefined
  if (globalThis.navigator?.userAgent === 'Cloudflare-Workers') {
    const cfRay = getSafeHeaders(e)?.['cf-ray']
    if (cfRay) requestIdOverride = cfRay
  }
  return createRequestLogger({
    method: e.method,
    path: e.path,
    requestId: requestIdOverride || e.context.requestId || crypto.randomUUID(),
  }, { _deferDrain: true })
}

async function emitWithTailSampling(
  nitroApp: NitroApp,
  requestLog: RequestLogger,
  e: ServerEvent,
  status: number,
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

  return requestLog.emit({ _forceKeep: tailCtx.shouldKeep, _durationMs: durationMs })
}

export default defineNitroPlugin(async (nitroApp) => {
  setActiveNitroRuntime('v2')
  const evlogConfig = await resolveEvlogConfigForNitroPlugin()

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
    redact,
    _suppressDrainWarning: true,
  })

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
      e.context.log = createDeferredRequestLogger(e)
    })
    return
  }

  nitroApp.hooks.hook('request', (event) => {
    const e = event as ServerEvent

    // Evaluate route filtering but always create the logger so that server
    // middleware (which runs for every request) can call useLogger(event)
    // without throwing.  Filtering is enforced at emit time instead.
    e.context._evlogShouldEmit = shouldLog(e.path, evlogConfig?.include, evlogConfig?.exclude)

    // Store start time for duration calculation in tail sampling
    e.context._evlogStartTime = Date.now()

    const requestLog = createDeferredRequestLogger(e)

    // Apply route-based service configuration if a matching route is found
    const routeService = getServiceForPath(e.path, evlogConfig?.routes)
    if (routeService) {
      requestLog.set({ service: routeService })
    }

    e.context.log = requestLog
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

      const emittedEvent = await emitWithTailSampling(nitroApp, requestLog, e, errorStatus)
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

    const emitSuccessResponse = async () => {
      const status = getResponseStatus(e)
      requestLog.set({ status })

      const emittedEvent = await emitWithTailSampling(nitroApp, requestLog, e, status)
      await callEnrichAndDrain(nitroApp, emittedEvent, e)
    }

    if (e.response && shouldDeferEmitForResponse(e.response)) {
      e.response = bindStreamingResponseLifecycle(e.response, async (meta) => {
        if (meta.error) {
          requestLog.error(meta.error)
        }
        await emitSuccessResponse()
      })
      return
    }

    await emitSuccessResponse()
  })
})
