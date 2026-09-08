import type { AsyncLocalStorage } from 'node:async_hooks'
import type { RequestLogger } from '../types'
import type { AuditableLogger } from '../audit'
import { attachForkToLogger } from './fork'
import { extractSafeHeaders, extractSafeNodeHeaders } from './headers'
import type { BaseEvlogOptions, MiddlewareLoggerOptions, MiddlewareLoggerResult } from './middleware'
import { createMiddlewareLogger } from './middleware'

/** Request shape extracted from a framework context. */
export interface ExtractedRequest {
  method: string
  path: string
  /**
   * Either a Web `Headers` (Hono / Elysia / Fetch) or a Node-style
   * `IncomingHttpHeaders` record (Express / Fastify). Whichever is native
   * to the framework — it gets filtered through the safe-header helpers.
   */
  headers?: Headers | Record<string, string | string[] | undefined>
  /** Used as-is when present, otherwise auto-generated. */
  requestId?: string
}

/** Manifest passed to {@link defineFrameworkIntegration}. */
export interface FrameworkIntegrationSpec<TCtx> {
  /** Stable identifier used in error messages. */
  name: string
  extractRequest: (ctx: TCtx) => ExtractedRequest
  /** Attach the request logger to the framework context (`c.set('log', logger)`). */
  attachLogger: (ctx: TCtx, logger: AuditableLogger) => void
  /**
   * AsyncLocalStorage instance backing `useLogger()`. Required for frameworks
   * where the logger is accessed off the request context (Express, Fastify,
   * NestJS). When set, `log.fork()` is auto-attached to the request logger.
   */
  storage?: AsyncLocalStorage<RequestLogger>
  /** Fork lifecycle hooks (only used when `storage` is set). */
  forkLifecycle?: import('./fork').ForkLifecycle
  /**
   * Extract platform `waitUntil` from the framework context (Cloudflare Workers
   * `ExecutionContext`, Vercel Edge, …). Applied on each `start()` call;
   * per-request `options.waitUntil` takes precedence.
   */
  extractWaitUntil?: (ctx: TCtx) => ((promise: Promise<unknown>) => void) | undefined
}

/** Result returned by {@link FrameworkIntegrationHelpers.start}. */
export interface FrameworkRequestHandle extends MiddlewareLoggerResult {
  middlewareOptions: MiddlewareLoggerOptions
  /**
   * Run the downstream handler inside the integration's storage. When no
   * storage is configured, the callback is invoked directly.
   */
  runWith: <T>(fn: () => T | Promise<T>) => Promise<T>
}

/** Helpers returned by {@link defineFrameworkIntegration}. */
export interface FrameworkIntegrationHelpers<TCtx> {
  start: (ctx: TCtx, options?: BaseEvlogOptions) => FrameworkRequestHandle
}

function normalizeHeaders(headers: ExtractedRequest['headers']): Record<string, string> | undefined {
  if (!headers) return undefined
  if (typeof (headers as Headers).forEach === 'function' && typeof (headers as Headers).get === 'function') {
    return extractSafeHeaders(headers as Headers)
  }
  return extractSafeNodeHeaders(headers as Record<string, string | string[] | undefined>)
}

/**
 * Build a manifest-driven framework integration. Captures the boilerplate
 * every middleware shares (request extraction, logger setup, attachment,
 * optional AsyncLocalStorage wrapping). The framework still owns its own
 * middleware function — it just declares *what* to extract and *where* to
 * attach the logger.
 *
 * @example
 * ```ts
 * const integration = defineFrameworkIntegration<HonoContext>({
 *   name: 'hono',
 *   extractRequest: (c) => ({
 *     method: c.req.method,
 *     path: c.req.path,
 *     headers: c.req.raw.headers,
 *     requestId: c.req.header('x-request-id'),
 *   }),
 *   attachLogger: (c, logger) => c.set('log', logger),
 * })
 *
 * export function evlog(options?: BaseEvlogOptions): MiddlewareHandler {
 *   return async (c, next) => {
 *     const { skipped, finish, runWith } = integration.start(c, options)
 *     if (skipped) return next()
 *     try {
 *       await runWith(() => next())
 *       await finish({ status: c.res.status })
 *     } catch (error) {
 *       await finish({ error: error as Error })
 *       throw error
 *     }
 *   }
 * }
 * ```
 */
export function defineFrameworkIntegration<TCtx>(
  spec: FrameworkIntegrationSpec<TCtx>,
): FrameworkIntegrationHelpers<TCtx> {
  return {
    start(ctx, options = {}) {
      const extracted = spec.extractRequest(ctx)
      const headers = normalizeHeaders(extracted.headers)
      const waitUntil = options.waitUntil ?? spec.extractWaitUntil?.(ctx)
      const middlewareOptions: MiddlewareLoggerOptions = {
        method: extracted.method,
        path: extracted.path,
        requestId: extracted.requestId || crypto.randomUUID(),
        headers,
        ...options,
        waitUntil,
      }
      const result = createMiddlewareLogger(middlewareOptions)

      if (!result.skipped) {
        if (spec.storage) {
          attachForkToLogger(spec.storage, result.logger, middlewareOptions, spec.forkLifecycle)
        }
        spec.attachLogger(ctx, result.logger)
      }

      const { storage } = spec
      const runWith = async <T>(fn: () => T | Promise<T>): Promise<T> => {
        if (!storage || result.skipped) return await fn()
        return await storage.run(result.logger, fn)
      }

      return { ...result, middlewareOptions, runWith }
    },
  }
}
