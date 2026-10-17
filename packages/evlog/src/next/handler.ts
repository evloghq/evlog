import { initLogger, isEnabled, isLoggerLocked } from '../logger'
import { defineFrameworkIntegration } from '../shared/integration'
import { pickBaseEvlogOptions } from '../shared/middleware'
import { EvlogError } from '../error'
import { extractErrorStatus } from '../shared/errors'
import { enrichNextErrorStackForDev } from './enrich-error-stack'
import type { NextEvlogOptions } from './types'
import { evlogStorage } from './storage'

interface WithEvlogState {
  initialized: boolean
  options: NextEvlogOptions
}

const state: WithEvlogState = {
  initialized: false,
  options: {},
}

export function configureHandler(options: NextEvlogOptions): void {
  state.options = options
  state.initialized = true

  // Skip if instrumentation register() already configured the logger.
  // Re-initializing would wipe the global drain.
  if (isLoggerLocked()) return

  // Don't pass drain to initLogger — the global drain fires inside emitWideEvent
  // which doesn't have request/header context. The shared middleware pipeline
  // calls the drain itself, after enrich, with full request context.
  initLogger({
    enabled: options.enabled,
    env: {
      service: options.service,
      ...options.env,
    },
    pretty: options.pretty,
    silent: options.silent,
    sampling: options.sampling,
    minLevel: options.minLevel,
    stringify: options.stringify,
    redact: options.redact,
    _suppressDrainWarning: true,
  })
}

type AfterFn = (task: () => unknown) => void

let cachedAfter: AfterFn | null | undefined

/**
 * Resolve Next's `after()` once. It is the Next equivalent of a serverless
 * `waitUntil`: work registered with it runs once the response has been sent.
 * Returns `null` on older Next versions or outside a Next runtime.
 */
async function resolveAfter(): Promise<AfterFn | null> {
  if (cachedAfter !== undefined) return cachedAfter
  try {
    const { after } = await import('next/server')
    cachedAfter = typeof after === 'function' ? (after as AfterFn) : null
  } catch {
    cachedAfter = null
  }
  return cachedAfter
}

/**
 * Rethrow `error` if Next.js recognizes it as an internal control-flow signal
 * (`redirect()`, `notFound()`, `forbidden()`, `unauthorized()`, ...) rather than a real
 * application error. No-ops otherwise, letting the caller continue with normal error
 * logging.
 *
 * Delegates to Next's own `unstable_rethrow`, which covers current and future signal
 * types without hardcoding digest strings — including signals wrapped in `error.cause`,
 * which it rethrows unwrapped. `next/navigation` import failures (older Next.js versions,
 * non-Next runtimes) are swallowed so the caller falls through to normal logging.
 */
async function rethrowIfNextNavigationSignal(error: unknown): Promise<void> {
  let unstableRethrow: ((error: unknown) => void) | undefined
  try {
    const nextNavigation = await import('next/navigation') as {
      unstable_rethrow?: (error: unknown) => void
    }
    unstableRethrow = nextNavigation.unstable_rethrow
  } catch {
    return
  }

  if (typeof unstableRethrow !== 'function') return

  // Throws (possibly the unwrapped `error.cause`) iff this is a recognized signal.
  unstableRethrow(error)
}

/**
 * Request shape handed to the shared integration. `withEvlog` also wraps
 * server actions, whose first argument is not a `Request` — those log under
 * `UNKNOWN /`.
 */
interface NextRequestContext {
  request?: Request
}

const integration = defineFrameworkIntegration<NextRequestContext>({
  name: 'next',
  extractRequest: ({ request }) => {
    if (!request) return { method: 'UNKNOWN', path: '/' }
    return {
      method: request.method,
      path: new URL(request.url, 'http://localhost').pathname,
      headers: request.headers,
      requestId: request.headers.get('x-request-id') ?? undefined,
    }
  },
  attachLogger: () => {
    /* Next exposes the logger through AsyncLocalStorage only (`useLogger()`). */
  },
  storage: evlogStorage,
})

/**
 * Wrap a Next.js route handler or server action with evlog request-scoped logging.
 *
 * @example
 * ```ts
 * // Route handler
 * export const POST = withEvlog(async (request: NextRequest) => {
 *   const log = useLogger()
 *   log.set({ user: { id: '123' } })
 *   return Response.json({ success: true })
 * })
 *
 * // Server action
 * export const checkout = withEvlog(async (formData: FormData) => {
 *   const log = useLogger()
 *   log.set({ action: 'checkout' })
 * })
 * ```
 */
export function createWithEvlog(options: NextEvlogOptions) {
  configureHandler(options)

  return function withEvlog<TArgs extends unknown[], TReturn>(
    handler: (...args: TArgs) => TReturn,
  ): (...args: TArgs) => Promise<Awaited<TReturn>> {
    return async (...args: TArgs): Promise<Awaited<TReturn>> => {
      if (!isEnabled()) {
        return await handler(...args) as Awaited<TReturn>
      }

      // Extract request info from first argument if it's a Request
      const [firstArg] = args
      const isRequest = firstArg instanceof Request
      const request = isRequest ? firstArg : undefined

      // Next's `after()` is its `waitUntil`: drain work runs once the response
      // has been sent. Resolved before `start()` so it reaches the pipeline.
      const after = await resolveAfter()
      const { logger, finish, finishResponse, skipped, runWith } = integration.start(
        { request },
        {
          ...pickBaseEvlogOptions(state.options),
          ...(after ? { waitUntil: (promise: Promise<unknown>) => after(() => promise) } : {}),
        },
      )

      if (skipped) {
        return await handler(...args) as Awaited<TReturn>
      }

      // Apply start time from middleware if present
      if (request) {
        const startHeader = request.headers.get('x-evlog-start')
        if (startHeader) {
          logger.set({ middlewareStart: Number(startHeader) })
        }
      }

      try {
        const result = await runWith(() => handler(...args))

        if (result instanceof Response) {
          return await finishResponse(result, { status: result.status }) as Awaited<TReturn>
        }

        await finish({ status: 200 })
        return result as Awaited<TReturn>
      } catch (error) {
        // redirect()/notFound()/forbidden()/unauthorized() throw a control-flow signal
        // that Next.js turns into a real response — not an application error. Rethrow it
        // untouched instead of logging a phantom ERROR@500 (see #436).
        await rethrowIfNextNavigationSignal(error)

        const err = error instanceof Error ? error : new Error(String(error))
        await enrichNextErrorStackForDev(err, { pretty: state.options.pretty })

        // `finish({ error })` records the error and derives the status via the
        // shared `extractErrorStatus`, matching every other integration.
        await finish({ error: err })

        // Return structured JSON response for EvlogErrors (like H3 does for Nuxt)
        if (isRequest && EvlogError.isEvlogError(error)) {
          return Response.json(error.toJSON(), { status: extractErrorStatus(error) }) as Awaited<TReturn>
        }

        throw error
      }
    }
  }
}
