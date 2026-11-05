import type { Context, MiddlewareHandler } from 'hono'
import type { ForkableLogger } from '../audit'
import { defineFrameworkIntegration } from '../shared/integration'
import type { BaseEvlogOptions } from '../shared/middleware'
import { createLoggerStorage } from '../shared/storage'
import { shouldDeferEmitForResponse } from '../shared/streamResponse'

const { storage, useLogger } = createLoggerStorage(
  'middleware context. Make sure app.use(evlog()) is registered before your routes.',
  'evlog:hono',
)

export type EvlogHonoOptions = BaseEvlogOptions

/**
 * Get the request-scoped logger from anywhere in the call stack, without
 * threading the Hono `Context` through every function.
 *
 * `c.get('log')` stays the idiomatic accessor inside route handlers — this is
 * for the layers underneath (services, repositories) where `c` is not in hand.
 * Both return the same logger.
 *
 * Backed by `AsyncLocalStorage`, so on Cloudflare Workers this requires the
 * `nodejs_compat` (or `nodejs_als`) compatibility flag. `c.get('log')` works
 * with or without it.
 *
 * @example
 * ```ts
 * import { useLogger } from 'evlog/hono'
 *
 * async function chargeCard(amount: number) {
 *   const log = useLogger()
 *   log.set({ payment: { amount } })
 * }
 * ```
 */
export { useLogger }

/**
 * Hono variables type for typed `c.get('log')` access.
 *
 * @example
 * ```ts
 * const app = new Hono<EvlogVariables>()
 * app.use(evlog())
 * app.get('/api/users', (c) => {
 *   const log = c.get('log')
 *   log.set({ users: { count: 42 } })
 *   return c.json({ users: [] })
 * })
 * ```
 */
export type EvlogVariables = { Variables: { log: ForkableLogger } }

const integration = defineFrameworkIntegration<Context>({
  name: 'hono',
  extractRequest: (c) => ({
    method: c.req.method,
    path: c.req.path,
    headers: c.req.raw.headers,
    requestId: c.req.header('x-request-id'),
  }),
  attachLogger: (c, logger) => {
    c.set('log', logger)
  },
  storage,
  extractWaitUntil: (c) => {
    // Hono's `executionCtx` getter throws when the adapter has none (Node,
    // Bun, Deno). Only Workers / Vercel Edge provide one.
    try {
      const { executionCtx } = c
      return typeof executionCtx?.waitUntil === 'function'
        ? executionCtx.waitUntil.bind(executionCtx)
        : undefined
    } catch {
      return undefined
    }
  },
})

/**
 * Create an evlog middleware for Hono.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { evlog, type EvlogVariables } from 'evlog/hono'
 * import { createAxiomDrain } from 'evlog/axiom'
 *
 * const app = new Hono<EvlogVariables>()
 * app.use(evlog({
 *   drain: createAxiomDrain(),
 *   enrich: (ctx) => {
 *     ctx.event.region = process.env.FLY_REGION
 *   },
 * }))
 * ```
 */
export function evlog(options: EvlogHonoOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const { skipped, logger, finish, finishResponse, runWith } = integration.start(c, options)
    if (skipped) {
      await next()
      return
    }
    try {
      await runWith(next)
      // Hono's compose hands a thrown error to `app.onError` at the route's own
      // dispatch level, so `next()` returns normally and `c.error` is the only trace.
      if (c.error) logger.error(c.error)
      if (shouldDeferEmitForResponse(c.res)) {
        // Assign directly — Hono's compose ignores middleware return values when
        // context.finalized is already true, so returning the wrapped response
        // would leave c.res with a locked body stream.
        c.res = await finishResponse(c.res, { status: c.res.status })
        return
      }
      await finish({ status: c.res.status })
    } catch (error) {
      await finish({ error: error as Error })
      throw error
    }
  }
}
