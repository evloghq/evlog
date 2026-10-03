import type { NitroApp } from 'nitropack/types'
import { getHeaders } from 'h3'
import { getGlobalPluginRunner, outputWideEvent } from '../logger'
import type { EnrichContext, ServerEvent, WideEvent } from '../types'
import { filterSafeHeaders } from '../utils'
import { extendDeferredDrain } from './deferred-drain'

export function getSafeHeaders(event: ServerEvent): Record<string, string> {
  const allHeaders = getHeaders(event as Parameters<typeof getHeaders>[0])
  return filterSafeHeaders(allHeaders)
}

function getSafeResponseHeaders(event: ServerEvent): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  const nodeRes = event.node?.res as { getHeaders?: () => Record<string, unknown> } | undefined

  if (nodeRes?.getHeaders) {
    for (const [key, value] of Object.entries(nodeRes.getHeaders())) {
      if (value === undefined) continue
      headers[key] = Array.isArray(value) ? value.join(', ') : String(value)
    }
  }

  if (event.response?.headers) {
    event.response.headers.forEach((value, key) => {
      headers[key] = value
    })
  }

  if (Object.keys(headers).length === 0) return undefined
  return filterSafeHeaders(headers)
}

export function getResponseStatus(event: ServerEvent): number {
  if (event.node?.res?.statusCode) {
    return event.node.res.statusCode
  }
  if (event.response?.status) {
    return event.response.status
  }
  if (typeof event.context.status === 'number') {
    return event.context.status
  }
  return 200
}

function buildHookContext(event: ServerEvent): Omit<EnrichContext, 'event'> {
  const responseHeaders = getSafeResponseHeaders(event)
  return {
    request: { method: event.method, path: event.path },
    headers: getSafeHeaders(event),
    response: {
      status: getResponseStatus(event),
      headers: responseHeaders,
    },
  }
}

function resolveDeferredWaitUntil(event: ServerEvent): ((promise: Promise<unknown>) => void) | undefined {
  if (globalThis.navigator?.userAgent !== 'Cloudflare-Workers') return undefined
  const waitUntilCtx = event.context.cloudflare?.context ?? event.context
  if (typeof waitUntilCtx?.waitUntil === 'function') {
    return waitUntilCtx.waitUntil.bind(waitUntilCtx)
  }
  return undefined
}

/**
 * Run evlog enrich + drain hooks for an emitted wide event.
 * @internal Exported for Nitro plugin tests.
 */
export async function callEnrichAndDrain(
  nitroApp: NitroApp,
  emittedEvent: WideEvent | null,
  event: ServerEvent,
  options?: { deferDrain?: boolean },
): Promise<void> {
  if (!emittedEvent) return

  const hookContext = buildHookContext(event)
  const enrichCtx: EnrichContext = { event: emittedEvent, ...hookContext }
  const runner = getGlobalPluginRunner()

  try {
    await nitroApp.hooks.callHook('evlog:enrich', enrichCtx)
  } catch (err) {
    console.error('[evlog] enrich failed:', err)
  }
  await runner.runEnrich(enrichCtx)
  outputWideEvent(emittedEvent)

  const drainCtx = {
    event: emittedEvent,
    request: hookContext.request,
    headers: hookContext.headers,
  }
  const drainTasks: Array<Promise<unknown>> = [
    nitroApp.hooks.callHook('evlog:drain', drainCtx).catch((err) => {
      console.error('[evlog] drain failed:', err)
    }),
    runner.runDrain(drainCtx),
  ]
  const drainPromise = Promise.all(drainTasks)

  // deferDrain: never block the HTTP error response on Nitro Node (h3 2.13+ waitUntil
  // queues work before send). On Cloudflare, register waitUntil so drains survive.
  if (options?.deferDrain) {
    extendDeferredDrain(drainPromise, resolveDeferredWaitUntil(event))
    return
  }

  const waitUntilCtx = event.context.cloudflare?.context ?? event.context
  if (typeof waitUntilCtx?.waitUntil === 'function') {
    waitUntilCtx.waitUntil(drainPromise)
  } else {
    await drainPromise
  }
}
