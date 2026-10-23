/**
 * Community framework integration skeleton — reference implementation.
 *
 * This shows how to wire any "request → handler → response" framework into
 * evlog using `defineFrameworkIntegration`. We implement a tiny pretend
 * framework called `MyFramework` whose middleware shape is
 * `(ctx, next) => void | Promise<void>` — the same shape as Hono / Express /
 * Elysia / Fastify hooks.
 *
 * Replace `MyFramework` everywhere with your actual framework name and ship as
 * `evlog-myframework`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RequestLogger } from 'evlog'
import {
  defineFrameworkIntegration,
  type BaseEvlogOptions,
} from 'evlog/toolkit'
import { createLoggerStorage } from 'evlog/toolkit/storage'

/** The framework's per-request context shape. */
export interface MyFrameworkContext {
  req: IncomingMessage
  res: ServerResponse
  /** Where the framework already exposes route info. */
  route: { method: string; path: string }
  /** Logger slot, populated by our middleware. */
  log?: RequestLogger
}

/** The framework's middleware signature. */
export type MyFrameworkMiddleware = (
  ctx: MyFrameworkContext,
  next: () => Promise<void>,
) => Promise<void>

export type EvlogMyFrameworkOptions = BaseEvlogOptions

const { storage, useLogger } = createLoggerStorage(
  'middleware context. Make sure evlog() is registered before your routes.',
)

export { useLogger }

const integration = defineFrameworkIntegration<MyFrameworkContext>({
  name: 'myframework',
  extractRequest: (ctx) => ({
    method: ctx.route.method,
    path: ctx.route.path,
    headers: ctx.req.headers,
    requestId: typeof ctx.req.headers['x-request-id'] === 'string'
      ? ctx.req.headers['x-request-id']
      : undefined,
  }),
  attachLogger: (ctx, logger) => {
    ctx.log = logger
  },
  storage,
})

/**
 * Create the evlog middleware for MyFramework.
 *
 * @example
 * ```ts
 * import { evlog, useLogger } from 'evlog-myframework'
 * import { createAxiomDrain } from 'evlog/axiom'
 *
 * app.use(evlog({ drain: createAxiomDrain() }))
 *
 * function findUser() {
 *   const log = useLogger()
 *   log.set({ user: { id: 42 } })
 * }
 * ```
 */
export function evlog(options: EvlogMyFrameworkOptions = {}): MyFrameworkMiddleware {
  return async (ctx, next) => {
    const { skipped, finish, runWith } = integration.start(ctx, options)
    if (skipped) {
      await next()
      return
    }
    try {
      await runWith(() => next())
      await finish({ status: ctx.res.statusCode })
    } catch (error) {
      await finish({ error: error instanceof Error ? error : new Error(String(error)) })
      throw error
    }
  }
}
