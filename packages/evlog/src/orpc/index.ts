import { ORPCError, type Context, type MiddlewareOptions, type MiddlewareResult } from '@orpc/server'
import type { ForkableLogger } from '../audit'
import { EvlogError } from '../error'
import { parseError } from '../runtime/utils/parseError'
import { defineFrameworkIntegration } from '../shared/integration'
import type { BaseEvlogOptions } from '../shared/middleware'
import { createLoggerStorage } from '../shared/storage'

const { storage, useLogger } = createLoggerStorage(
  'oRPC handler. Wrap your handler with `withEvlog()` from evlog/orpc.',
  'evlog:orpc',
)

/** Options accepted by {@link withEvlog} for oRPC request instrumentation. */
export type EvlogOrpcOptions = BaseEvlogOptions

/**
 * Access the current request-scoped logger outside oRPC context callbacks.
 * Requires {@link withEvlog} on the handler.
 */
export { useLogger }

/**
 * Inject this type into your oRPC initial context to access `context.log`
 * inside procedures.
 *
 * @example
 * ```ts
 * import { os } from '@orpc/server'
 * import { evlog, type EvlogOrpcContext } from 'evlog/orpc'
 *
 * const base = os.$context<EvlogOrpcContext>().use(evlog())
 * ```
 */
export interface EvlogOrpcContext {
  log: ForkableLogger
}

/**
 * Result shape of `handler.handle()` for oRPC's fetch adapter
 * ({@link https://orpc.dev/docs/adapters/http RPCHandler / OpenAPIHandler}).
 */
type OrpcFetchHandleResult =
  | { matched: true, response: Response }
  | { matched: false, response: undefined }

/**
 * Minimal subset of oRPC's `FetchHandler` that we need to wrap. Anything
 * compatible (RPCHandler, OpenAPIHandler, custom handler) plugs in.
 *
 * `options` is intentionally typed loosely so this matches both the
 * `(req, opts)` and `(req, opts?)` overloads that oRPC produces depending on
 * whether the router declares a non-empty initial context. The wrapper just
 * splats the original options through and injects `log` into `context`.
 */
interface OrpcFetchHandlerLike {
  handle: (
    request: Request,
    options?: any,
  ) => Promise<OrpcFetchHandleResult>
}

const integration = defineFrameworkIntegration<{ request: Request }>({
  name: 'orpc',
  extractRequest: ({ request }) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      path: url.pathname,
      headers: request.headers,
      requestId: request.headers.get('x-request-id') ?? undefined,
    }
  },
  attachLogger: () => {
    /* logger is injected into the oRPC context inside withEvlog() */
  },
  storage,
})

/**
 * Wrap an oRPC handler so each matched request emits a single wide event.
 * Works with any handler that exposes `.handle(request, options)` from
 * `@orpc/server/fetch` (RPCHandler, OpenAPIHandler, custom handlers).
 *
 * The returned proxy preserves the original handler's identity (instance
 * methods, plugins, etc.) and only intercepts `handle`. Inside procedures,
 * the request logger is exposed as `context.log` — pair this with
 * `os.use(evlog())` to also accumulate `operation` (`path.join('.')`) on the
 * wide event.
 *
 * Routes that are filtered out by `include`/`exclude` are passed straight to
 * the underlying handler with no instrumentation.
 *
 * @example
 * ```ts
 * import { RPCHandler } from '@orpc/server/fetch'
 * import { withEvlog } from 'evlog/orpc'
 * import { router } from './router'
 *
 * const handler = withEvlog(new RPCHandler(router), {
 *   include: ['/rpc/**'],
 * })
 *
 * export default async function fetch(request: Request) {
 *   const { matched, response } = await handler.handle(request, { prefix: '/rpc' })
 *   return matched ? response : new Response('Not Found', { status: 404 })
 * }
 * ```
 */
export function withEvlog<THandler extends OrpcFetchHandlerLike>(
  handler: THandler,
  options: EvlogOrpcOptions = {},
): THandler {
  const handle: THandler['handle'] = async (request, callOptions) => {
    const { skipped, finish, finishResponse, runWith, logger } = integration.start({ request }, options)

    const initialContext = (callOptions as { context?: Record<string, unknown> } | undefined)?.context ?? {}
    const finalOptions = {
      ...callOptions,
      context: { ...initialContext, log: logger },
    } as Parameters<THandler['handle']>[1]

    if (skipped) {
      return handler.handle(request, finalOptions)
    }

    try {
      const result = await runWith(() => handler.handle(request, finalOptions))
      if (result.matched) {
        result.response = await finishResponse(result.response, { status: result.response.status })
      } else {
        await finish({ status: 404 })
      }
      return result
    } catch (error) {
      await finish({ error: error as Error })
      throw error
    }
  }

  return new Proxy(handler, {
    get(target, prop, receiver) {
      if (prop === 'handle') return handle
      return Reflect.get(target, prop, receiver)
    },
  })
}

/**
 * Procedure-level middleware. Three responsibilities:
 *
 * 1. Adds `operation` (the procedure path joined by `.`) to the wide event,
 *    so consumers can group events by procedure without parsing URLs.
 * 2. Captures errors thrown by the procedure on the wide event so the level
 *    is promoted to `error`.
 * 3. Converts {@link EvlogError} (from `createError()` / `defineErrorCatalog`)
 *    into a structurally-equivalent {@link ORPCError} before re-throwing, so
 *    the wire response carries the catalog `code`, status, message, and the
 *    `why` / `fix` / `link` guidance under `data` — instead of being wrapped
 *    as `INTERNAL_SERVER_ERROR` by oRPC's default handler. The catalog and
 *    `createError()` stay the canonical evlog way to author errors;
 *    `evlog/orpc` is the bridge.
 *
 * Requires `withEvlog()` to be wrapped around the handler — the request
 * logger flows in via `context.log`. Declare {@link EvlogOrpcContext} on
 * your oRPC base for typed access.
 *
 * @example
 * ```ts
 * import { os } from '@orpc/server'
 * import { evlog, type EvlogOrpcContext } from 'evlog/orpc'
 *
 * const base = os.$context<EvlogOrpcContext>().use(evlog())
 *
 * export const getUser = base
 *   .input(z.object({ id: z.string() }))
 *   .handler(async ({ input, context }) => {
 *     context.log.set({ user: { id: input.id } })
 *     return await db.user.findUnique(input)
 *   })
 * ```
 */
export function evlog<TContext extends Partial<EvlogOrpcContext> & Context = EvlogOrpcContext>() {
  return async function evlogMiddleware(
    options: MiddlewareOptions<TContext, unknown, any, any>,
  ): Promise<MiddlewareResult<Record<never, never>, unknown>> {
    const { context: { log }, path, next } = options
    if (log && path.length > 0) {
      log.set({ operation: path.join('.') })
    }
    try {
      return await next()
    } catch (error) {
      if (log) log.error(error as Error)
      if (EvlogError.isEvlogError(error)) {
        throw toOrpcError(error)
      }
      throw error
    }
  }
}

function toOrpcError(error: EvlogError): ORPCError<string, Record<string, unknown>> {
  const parsed = parseError(error)
  // `code` travels as the ORPC error code, the rest of the payload as its data.
  const { code: _code, ...data } = parsed.data ?? {}
  return new ORPCError(parsed.code ?? 'EVLOG_ERROR', {
    status: parsed.status,
    message: parsed.message,
    data,
    cause: error,
  })
}
