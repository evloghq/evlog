import { createContext } from 'react-router'
import type { ForkableLogger } from '../audit'
import { defineFrameworkIntegration } from '../shared/integration'
import type { BaseEvlogOptions } from '../shared/middleware'
import { createLoggerStorage } from '../shared/storage'

const { storage, useLogger } = createLoggerStorage(
  'middleware context. Make sure the evlog middleware is added to your route.',
  'evlog:react-router',
)

/**
 * Typed context key for accessing the evlog logger in loaders and actions.
 *
 * @example
 * ```ts
 * import { loggerContext } from 'evlog/react-router'
 *
 * export async function loader({ context }: Route.LoaderArgs) {
 *   const log = context.get(loggerContext)
 *   log.set({ user: { id: 'u-1' } })
 *   return { ok: true }
 * }
 * ```
 */
export const loggerContext = createContext<ForkableLogger>()

export type EvlogReactRouterOptions = BaseEvlogOptions

export { useLogger }

interface ReactRouterContext {
  request: Request
  context: { set(ctx: unknown, value: unknown): void }
}

const integration = defineFrameworkIntegration<ReactRouterContext>({
  name: 'react-router',
  extractRequest: ({ request }) => ({
    method: request.method,
    path: new URL(request.url).pathname,
    headers: request.headers,
    requestId: request.headers.get('x-request-id') ?? undefined,
  }),
  attachLogger: ({ context }, logger) => {
    context.set(loggerContext, logger)
  },
  storage,
})

/**
 * Create an evlog middleware for React Router.
 *
 * @example
 * ```ts
 * // app/root.tsx
 * import { evlog } from 'evlog/react-router'
 *
 * export const middleware: Route.MiddlewareFunction[] = [
 *   evlog({ drain: createAxiomDrain() }),
 * ]
 * ```
 */
export function evlog(options: EvlogReactRouterOptions = {}) {
  return async (
    ctx: ReactRouterContext,
    next: () => Promise<Response>,
  ): Promise<Response> => {
    const { logger, finish, finishResponse, skipped, runWith } = integration.start(ctx, options)

    if (skipped) {
      ctx.context.set(loggerContext, logger)
      return next()
    }

    try {
      const response = await runWith(next)
      return finishResponse(response, { status: response.status })
    } catch (error) {
      await finish({ error: error as Error })
      throw error
    }
  }
}
