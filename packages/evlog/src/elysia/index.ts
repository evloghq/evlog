import { AsyncLocalStorage } from 'node:async_hooks'
import { Elysia } from 'elysia'
import type { AuditableLogger } from '../audit'
import {
  bindAsyncLocalStorage,
  clearAsyncLocalStorage,
  createSharedEnterWithStorage,
} from '../shared/asyncStorageScope'
import { defineFrameworkIntegration } from '../shared/integration'
import { bindStreamingResponseLifecycle, shouldDeferEmitForResponse } from '../shared/streamResponse'
import type { BaseEvlogOptions } from '../shared/middleware'
import { attachForkToLogger } from '../shared/fork'

/** @internal Every registered instance is a real ALS; the registry only widens the type. */
const storage = createSharedEnterWithStorage(
  'evlog:elysia',
  () => new AsyncLocalStorage<AuditableLogger>(),
) as AsyncLocalStorage<AuditableLogger>

const activeLoggers = new WeakSet<AuditableLogger>()

export type EvlogElysiaOptions = BaseEvlogOptions

/**
 * Get the request-scoped logger from anywhere in the call stack.
 * Must be called inside a request handled by the `evlog()` plugin.
 *
 * Elysia binds the logger with `enterWith()` because its lifecycle hooks are
 * separate from the route handler. On Cloudflare Workers, a small polyfill
 * provides `enterWith()` when the runtime omits it. Prefer `{ log }` from
 * derive when multiple requests may interleave in the same isolate.
 *
 * @example
 * ```ts
 * import { useLogger } from 'evlog/elysia'
 *
 * function findUser(id: string) {
 *   const log = useLogger()
 *   log.set({ user: { id } })
 * }
 * ```
 */
export function useLogger<T extends object = Record<string, unknown>>(): AuditableLogger<T>
// eslint-disable-next-line no-redeclare -- TypeScript overload implementation.
export function useLogger(): AuditableLogger {
  const logger = storage.getStore()
  if (!logger || !activeLoggers.has(logger)) {
    throw new Error(
      '[evlog] useLogger() was called outside of an evlog plugin context. '
      + 'Make sure app.use(evlog()) is registered before your routes.',
    )
  }
  return logger
}

interface ElysiaContext {
  request: Request
  path: string
  headers: Record<string, string>
}

const integration = defineFrameworkIntegration<ElysiaContext>({
  name: 'elysia',
  extractRequest: ({ request, path, headers }) => ({
    method: request.method,
    path,
    headers,
    requestId: headers['x-request-id'],
  }),
  attachLogger: ({ request, path, headers }, logger) => {
    attachForkToLogger(storage, logger, {
      method: request.method,
      path,
      requestId: headers['x-request-id'],
    }, {
      onChildEnter: (child) => {
        activeLoggers.add(child)
      },
      onChildExit: (child) => {
        activeLoggers.delete(child)
      },
    })
    activeLoggers.add(logger)
  },
})

interface RequestState {
  finish: (opts?: { status?: number; error?: Error }) => Promise<unknown>
  skipped: boolean
  logger: AuditableLogger
}

/** Release the request logger once its wide event has been emitted. */
function releaseLogger(logger: AuditableLogger): void {
  activeLoggers.delete(logger)
  clearAsyncLocalStorage(storage)
}

/**
 * Create an evlog plugin for Elysia.
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia'
 * import { evlog } from 'evlog/elysia'
 * import { createAxiomDrain } from 'evlog/axiom'
 *
 * const app = new Elysia()
 *   .use(evlog({
 *     drain: createAxiomDrain(),
 *     enrich: (ctx) => {
 *       ctx.event.region = process.env.FLY_REGION
 *     },
 *   }))
 *   .get('/health', ({ log }) => {
 *     log.set({ route: 'health' })
 *     return { ok: true }
 *   })
 *   .listen(3000)
 * ```
 */
export function evlog(options: EvlogElysiaOptions = {}) {
  const emitted = new WeakSet<Request>()
  const requestState = new WeakMap<Request, RequestState>()

  return new Elysia({ name: 'evlog' })
    .onRequest(({ request }) => {
      const url = new URL(request.url)
      const headers = (request.headers).toJSON?.() ?? Object.fromEntries(request.headers.entries())
      const ctx: ElysiaContext = { request, path: url.pathname, headers }
      const { logger, finish, skipped } = integration.start(ctx, options)
      if (!skipped) {
        bindAsyncLocalStorage(storage, logger)
      }
      requestState.set(request, { finish, skipped, logger })
    })
    .derive({ as: 'global' }, ({ request }) => {
      return { log: requestState.get(request)?.logger as AuditableLogger }
    })
    // Claim streaming responses here: `onAfterResponse` fires once the response
    // is handed off, which for an SSE / chunked body is long before the stream
    // finishes. Wrapping the body defers the emit until it actually closes, so
    // context set mid-stream still lands on the wide event (#321).
    .mapResponse({ as: 'global' }, (ctx) => {
      const { request } = ctx
      const state = requestState.get(request)
      if (!state || state.skipped || emitted.has(request)) return
      const value = (ctx as { responseValue?: unknown; response?: unknown }).responseValue
        ?? (ctx as { response?: unknown }).response
      if (!(value instanceof Response) || !shouldDeferEmitForResponse(value)) return

      emitted.add(request)
      return bindStreamingResponseLifecycle(value, async (meta) => {
        await state.finish({ status: meta.status, error: meta.error })
        releaseLogger(state.logger)
      })
    })
    .onAfterResponse({ as: 'global' }, async ({ request, set }) => {
      const state = requestState.get(request)
      if (!state || state.skipped || emitted.has(request)) return
      emitted.add(request)
      await state.finish({ status: set.status as number || 200 })
      releaseLogger(state.logger)
    })
    .onError({ as: 'global' }, async ({ request, error }) => {
      const state = requestState.get(request)
      if (!state || state.skipped || emitted.has(request)) return
      emitted.add(request)
      const err = error instanceof Error ? error : new Error(String(error))
      await state.finish({ error: err })
      releaseLogger(state.logger)
    })
}
