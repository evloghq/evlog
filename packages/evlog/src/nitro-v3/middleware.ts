import type { RequestServerResult } from '@tanstack/start-client-core'
import type { RequestLogger } from '../types'
import { EvlogError } from '../error'
import { extractErrorStatus } from '../shared/errors'

/**
 * Server middleware handler that catches EvlogError and returns a structured JSON response.
 *
 * Frameworks like TanStack Start catch thrown errors before Nitro's error handler,
 * stripping the `data` field (containing `why`, `fix`, `link`). This middleware
 * intercepts EvlogErrors first, attaches them to the wide event, and throws a
 * `Response` that the framework passes through directly.
 *
 * @example TanStack Start
 * ```ts
 * import { createMiddleware } from '@tanstack/react-start'
 * import { evlogErrorHandler } from 'evlog/nitro'
 *
 * const evlogMiddleware = createMiddleware().server(evlogErrorHandler)
 *
 * export const Route = createRootRoute({
 *   server: { middleware: [evlogMiddleware] },
 * })
 * ```
 */

/**
 * TanStack's `RequestServerNextFn` may return synchronously or as a `Promise`, and uses a
 * typed `options` argument. A rest-args `any[]` signature keeps `RequestServerNextFn`
 * assignable under `strictFunctionTypes`. The return type matches `createMiddleware().server()`.
 */
type EvlogServerMiddlewareNext = (...args: any[]) => unknown | Promise<unknown>

export async function evlogErrorHandler(
  nextOrOptions: EvlogServerMiddlewareNext | { next: EvlogServerMiddlewareNext },
): Promise<RequestServerResult<any, any, any> | Response> {
  const next = typeof nextOrOptions === 'function' ? nextOrOptions : nextOrOptions.next
  try {
    return (await Promise.resolve(next())) as RequestServerResult<any, any, any>
  } catch (error: unknown) {
    if (EvlogError.isEvlogError(error)) {
      const evlogError = error as EvlogError

      try {
        const { useRequest } = await import('nitro/context')
        const req = useRequest()
        const log = req.context?.log as RequestLogger | undefined
        log?.error(evlogError)
      } catch {
        // ignore
      }

      // Throw as Response so frameworks (TanStack Start, SolidStart, etc.) pass it through
      throw new Response(JSON.stringify(evlogError.toJSON()), {
        status: extractErrorStatus(evlogError),
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw error
  }
}
