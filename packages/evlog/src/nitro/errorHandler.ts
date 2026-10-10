// Import from specific subpath — the barrel 'nitropack/runtime' re-exports from
// internal/app.mjs which imports virtual modules that crash outside rollup builds.
import { defineNitroErrorHandler } from 'nitropack/runtime/internal/error/utils'
import { getRequestHeader, getRequestURL, setResponseHeader, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import {
  resolveEvlogError,
  extractErrorStatus,
  buildPlainNitroErrorBody,
  isSensitiveNitroError,
  isExpectedEvlogError,
  serializeEvlogErrorResponse,
  markH3ErrorHandled,
  shouldSerializeNitroErrorAsJson,
  shouldSuppressNitroDevOverlay,
  suppressNitroDevOverlay,
} from '../nitro'

/**
 * Flush the error response by ending the Node response directly.
 *
 * h3 v1's `send()` is a no-op once the event is marked handled, and the event
 * must be marked handled *before* responding so Nitro's chained dev handler
 * (Youch overlay) does not run after us. Ending the Node response directly
 * resolves that tension: the flush is synchronous and unconditional (#374).
 */
function endNodeResponse(event: H3Event, body: string): void {
  if (!event.node.res.writableEnded) {
    event.node.res.end(body)
  }
}

/**
 * Custom Nitro error handler that properly serializes EvlogError.
 * This ensures that 'data' (containing 'why', 'fix', 'link') is preserved
 * in the JSON response regardless of the underlying HTTP framework.
 *
 * For non-EvlogError, it preserves Nitro's default response shape — `data`
 * from `createError({ data })` included — while withholding the details of
 * unhandled errors in production.
 */
export default defineNitroErrorHandler(async (error, event, ctx) => {
  const evlogError = resolveEvlogError(error)
  const requestUrl = getRequestURL(event, { xForwardedHost: true })
  // Read before `suppressNitroDevOverlay` clears the flags it relies on.
  const sensitive = isSensitiveNitroError(error)

  if (!shouldSerializeNitroErrorAsJson({
    pathname: requestUrl.pathname,
    getHeader: name => getRequestHeader(event, name),
  }, evlogError)) {
    return
  }

  const suppressOverlay = shouldSuppressNitroDevOverlay()

  // Nitro v2 always passes `ctx`, but a missing context (e.g. the handler
  // invoked directly) must degrade to a flushed response, not a crash.
  if (!suppressOverlay && !isExpectedEvlogError(evlogError) && ctx?.defaultHandler) {
    await ctx.defaultHandler(error, event, { silent: false })
  }

  markH3ErrorHandled(event)
  if (suppressOverlay) {
    suppressNitroDevOverlay(error)
  }

  const isDev = process.env.NODE_ENV === 'development'
  const url = requestUrl.pathname

  if (!evlogError) {
    const body = buildPlainNitroErrorBody(error, url, { isDev, sensitive })
    setResponseStatus(event, body.status as number)
    setResponseHeader(event, 'Content-Type', 'application/json')
    return endNodeResponse(event, JSON.stringify(body))
  }

  const status = extractErrorStatus(evlogError)

  setResponseStatus(event, status)
  setResponseHeader(event, 'Content-Type', 'application/json')

  return endNodeResponse(event, JSON.stringify(serializeEvlogErrorResponse(evlogError, url)))
})
