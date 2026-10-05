import { initLogger, createRequestLogger } from '../logger'
import type { AuditableLogger } from '../audit'
import type { LoggerConfig } from '../types'
import { defineFrameworkIntegration } from '../shared/integration'
import type { BaseEvlogOptions } from '../shared/middleware'

/**
 * Minimal Cloudflare Workers execution context (`fetch` third argument).
 * Matches Cloudflare `ExecutionContext` without requiring `@cloudflare/workers-types`.
 */
export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

/**
 * Options for createWorkersLogger
 */
export interface WorkersLoggerOptions {
  /** Override the request ID (default: cf-ray header) */
  requestId?: string
  /** Headers to include in logs (default: none) */
  headers?: string[]
  /**
   * Cloudflare Workers `ExecutionContext` from the `fetch` handler
   * (`async fetch(request, env, ctx)`). When set, async `initLogger({ drain })`
   * work from `log.emit()` is registered with `ctx.waitUntil` so drains (HTTP to
   * Axiom, PostHog, etc.) complete after the response is returned.
   *
   * Prefer {@link defineWorkerFetch} when you want this wired automatically.
   */
  executionCtx?: WorkerExecutionContext
  /**
   * Lower-level alternative to `executionCtx`: same function Cloudflare assigns to
   * `ExecutionContext#waitUntil` (must be bound if you extract the method), e.g.
   * `waitUntil: ctx.waitUntil.bind(ctx)`.
   */
  waitUntil?: (promise: Promise<unknown>) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectHeaders(headers: Headers, include: string[] | undefined): Record<string, string> | undefined {
  if (!include || include.length === 0) return undefined

  const normalized = new Set(include.map(h => h.toLowerCase()))
  const result: Record<string, string> = {}

  headers.forEach((value, key) => {
    if (normalized.has(key.toLowerCase())) {
      result[key] = value
    }
  })

  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Initialize evlog for Cloudflare Workers.
 * Call once at module scope.
 *
 * @example
 * ```ts
 * initWorkersLogger({
 *   env: { service: 'my-api' },
 * })
 * ```
 */
export function initWorkersLogger(options: LoggerConfig = {}): void {
  initLogger({
    ...options,
    pretty: false,
    stringify: false,
  })
}

/**
 * Wraps a Workers `fetch` handler so {@link createWorkersLogger} receives
 * `executionCtx` automatically for async drains (`initWorkersLogger({ drain })`).
 *
 * Cloudflare does not expose `ExecutionContext` globally — only as the third
 * `fetch` argument — so evlog cannot discover it without either this helper or
 * an explicit `{ executionCtx: ctx }` / `waitUntil` option.
 *
 * @example
 * ```ts
 * initWorkersLogger({ env: { service: 'my-api' }, drain: myDrain })
 *
 * export default defineWorkerFetch(async (request, env, ctx, log) => {
 *   log.set({ route: '/health' })
 *   log.emit({ status: 200 })
 *   return new Response('ok')
 * })
 * ```
 *
 * @typeParam TCtx - The handler's `ctx`. Unannotated, it is {@link WorkerExecutionContext}; annotate `ctx` (for
 *   example as `ExecutionContext` from `@cloudflare/workers-types`) or pass the type argument to reach the rest of
 *   Cloudflare's context, such as `ctx.exports` or `ctx.props`.
 */
export function defineWorkerFetch<TEnv = unknown, TCtx extends WorkerExecutionContext = WorkerExecutionContext>(
  handler: (
    request: Request,
    env: TEnv,
    ctx: TCtx,
    log: AuditableLogger,
  ) => Response | Promise<Response>,
): {
  fetch: (request: Request, env: TEnv, ctx: TCtx) => Promise<Response>
} {
  return {
    fetch(request, env, ctx) {
      const log = createWorkersLogger(request, { executionCtx: ctx })
      return Promise.resolve(handler(request, env, ctx, log))
    },
  }
}

function pickCfContext(request: Request): Record<string, unknown> {
  const cf = Reflect.get(request, 'cf')
  if (!isRecord(cf)) return {}

  const out: Record<string, unknown> = {}
  if (typeof cf.colo === 'string') out.colo = cf.colo
  if (typeof cf.country === 'string') out.country = cf.country
  if (typeof cf.asn === 'number') out.asn = cf.asn
  return out
}

/** Options accepted by {@link withEvlog}. */
export type EvlogWorkersOptions = BaseEvlogOptions

interface WorkersRequestContext {
  request: Request
  ctx?: WorkerExecutionContext
}

/**
 * Cloudflare-specific context every wide event carries: `cf-ray`, the
 * `traceparent` header, and the safe subset of `request.cf`.
 */
function applyCloudflareContext(request: Request, logger: AuditableLogger): void {
  logger.set({
    cfRay: request.headers.get('cf-ray') ?? undefined,
    traceparent: request.headers.get('traceparent') ?? undefined,
    ...pickCfContext(request),
  })
}

// No AsyncLocalStorage: `evlog/workers` must stay free of `node:async_hooks`
// so it runs without `nodejs_compat`. The logger reaches user code as the
// handler's fourth argument instead of through `useLogger()`.
const integration = defineFrameworkIntegration<WorkersRequestContext>({
  name: 'workers',
  extractRequest: ({ request }) => ({
    method: request.method,
    path: new URL(request.url).pathname,
    headers: request.headers,
    // `x-request-id` first to match every other integration; `cf-ray` is the
    // Cloudflare-native fallback when the caller sends no explicit id.
    requestId: request.headers.get('x-request-id') ?? request.headers.get('cf-ray') ?? undefined,
  }),
  attachLogger: ({ request }, logger) => {
    applyCloudflareContext(request, logger as AuditableLogger)
  },
  extractWaitUntil: ({ ctx }) =>
    ctx ? ctx.waitUntil.bind(ctx) : undefined,
})

/**
 * Wrap a Workers `fetch` handler so each request emits one wide event through
 * the same middleware pipeline every other evlog integration uses.
 *
 * Unlike {@link defineWorkerFetch}, the event is emitted for you when the
 * handler returns, and the full {@link BaseEvlogOptions} surface applies:
 * `include` / `exclude`, per-route `routes` overrides, `redact`, `enrich`,
 * `keep` tail sampling, `plugins` and `drain`. Streaming responses defer the
 * emit until the body completes, and `ctx.waitUntil` is picked up
 * automatically so drains finish after the response is returned.
 *
 * Filtered-out routes run the handler with no instrumentation.
 *
 * @example
 * ```ts
 * import { initWorkersLogger, withEvlog } from 'evlog/workers'
 * import { createAxiomDrain } from 'evlog/axiom'
 *
 * initWorkersLogger({ env: { service: 'my-api' } })
 *
 * export default withEvlog(
 *   async (request, env, ctx, log) => {
 *     log.set({ route: 'health' })
 *     return new Response('ok')
 *   },
 *   {
 *     drain: createAxiomDrain(),
 *     exclude: ['/health'],
 *   },
 * )
 * ```
 *
 * @typeParam TCtx - The handler's `ctx`. Unannotated, it is {@link WorkerExecutionContext}; annotate `ctx` (for
 *   example as `ExecutionContext` from `@cloudflare/workers-types`) or pass the type argument to reach the rest of
 *   Cloudflare's context, such as `ctx.exports` or `ctx.props`.
 */
export function withEvlog<TEnv = unknown, TCtx extends WorkerExecutionContext = WorkerExecutionContext>(
  handler: (
    request: Request,
    env: TEnv,
    ctx: TCtx,
    log: AuditableLogger,
  ) => Response | Promise<Response>,
  options: EvlogWorkersOptions = {},
): {
  fetch: (request: Request, env: TEnv, ctx: TCtx) => Promise<Response>
} {
  return {
    async fetch(request, env, ctx) {
      const { logger, finish, finishResponse, skipped } = integration.start({ request, ctx }, options)

      if (skipped) {
        return await handler(request, env, ctx, createWorkersLogger(request, { executionCtx: ctx }))
      }

      try {
        const response = await handler(request, env, ctx, logger)
        return await finishResponse(response, { status: response.status })
      } catch (error) {
        await finish({ error: error as Error })
        throw error
      }
    },
  }
}

/**
 * Create a request-scoped logger for Cloudflare Workers.
 * Auto-extracts cf-ray, request.cf context, method, and path.
 *
 * @example
 * ```ts
 * export default {
 *   async fetch(request: Request, env: Env, ctx: ExecutionContext) {
 *     const log = createWorkersLogger(request, { executionCtx: ctx })
 *
 *     log.set({ user: { id: '123' } })
 *     log.emit({ status: 200 })
 *
 *     return new Response('ok')
 *   }
 * }
 * ```
 */
export function createWorkersLogger<T extends object = Record<string, unknown>>(request: Request, options: WorkersLoggerOptions = {}): AuditableLogger<T> {
  const url = new URL(request.url)
  const cfRay = request.headers.get('cf-ray') ?? undefined
  const traceparent = request.headers.get('traceparent') ?? undefined

  const waitUntil =
    options.waitUntil
    ?? (options.executionCtx
      ? options.executionCtx.waitUntil.bind(options.executionCtx)
      : undefined)

  const log = createRequestLogger<T>({
    method: request.method,
    path: url.pathname,
    requestId: options.requestId ?? cfRay,
    waitUntil,
  })

  // Cast needed: CF-specific enrichment fields (cfRay, traceparent, etc.) aren't in user's T
  const untyped = log as unknown as AuditableLogger
  untyped.set({
    cfRay,
    traceparent,
    ...pickCfContext(request),
    ...(options.headers ? { requestHeaders: collectHeaders(request.headers, options.headers) } : {}),
  })

  return log
}
