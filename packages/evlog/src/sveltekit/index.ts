import type { RequestLogger } from '../types'
import { registerDiskPrettyErrorSnippetReader } from '../shared/register-disk-snippet'
import { defineFrameworkIntegration } from '../shared/integration'
import type { BaseEvlogOptions } from '../shared/middleware'
import { createLoggerStorage } from '../shared/storage'
import { resolveEvlogError, extractErrorStatus, serializeEvlogErrorResponse } from '../nitro'
import { EvlogError } from '../error'

const { storage, useLogger } = createLoggerStorage(
  'handle context. Make sure evlog() handle is added to your hooks.server.ts.',
  'evlog:sveltekit',
)

void registerDiskPrettyErrorSnippetReader()

export type EvlogSvelteKitOptions = BaseEvlogOptions

export { useLogger }

/**
 * SvelteKit `Handle` function signature — avoids a hard dependency on `@sveltejs/kit`.
 */
type SvelteKitHandle = (input: {
  event: SvelteKitRequestEvent
  resolve: (...args: any[]) => Response | Promise<Response>
}) => Promise<Response>

/** The subset of SvelteKit's `RequestEvent` the integration reads. */
interface SvelteKitRequestEvent {
  request: Request
  url: URL
  locals: Record<string, any>
}

const integration = defineFrameworkIntegration<SvelteKitRequestEvent>({
  name: 'sveltekit',
  extractRequest: ({ request, url }) => ({
    method: request.method,
    path: url.pathname,
    headers: request.headers,
    requestId: request.headers.get('x-request-id') ?? undefined,
  }),
  attachLogger: (event, logger) => {
    event.locals.log = logger
  },
  storage,
})

/**
 * SvelteKit `HandleServerError` signature — avoids a hard dependency on `@sveltejs/kit`.
 * Kit 2 passes `status` and `message`; Kit 3 passes a `kind` discriminant instead.
 */
type SvelteKitHandleServerError = (input: {
  error: unknown
  event: { request: Request; url: URL; locals: Record<string, any> }
} & ({ kind: string } | { status: number; message: string })) => MaybePromise<void | AppError>

type MaybePromise<T> = T | Promise<T>

/** Minimal SvelteKit `App.Error` shape */
interface AppError {
  message: string
  [key: string]: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequestLogger(value: unknown): value is RequestLogger {
  return isPlainObject(value)
    && typeof value.error === 'function'
    && typeof value.emit === 'function'
}

interface ContextEvlogError {
  name: 'EvlogError'
  status: number
  message: string
  why?: string
  fix?: string
  link?: string
  code?: string
}

function isContextEvlogError(value: unknown): value is Record<string, unknown> & ContextEvlogError {
  return isPlainObject(value)
    && value.name === 'EvlogError'
    && typeof value.status === 'number'
    && typeof value.message === 'string'
}

function evlogErrorFromContext(errorData: Record<string, unknown>): EvlogError {
  const nested = isPlainObject(errorData.data) ? errorData.data : undefined
  const readString = (key: string): string | undefined => {
    const direct = errorData[key]
    if (typeof direct === 'string') return direct
    const fromNested = nested?.[key]
    return typeof fromNested === 'string' ? fromNested : undefined
  }
  return new EvlogError({
    message: String(errorData.message),
    status: errorData.status as number,
    code: readString('code'),
    why: readString('why'),
    fix: readString('fix'),
    link: readString('link'),
    data: nested,
  })
}

function readEvlogResponseData(response: Record<string, unknown>): { why?: string, fix?: string, link?: string } {
  const { data } = response
  if (!isPlainObject(data)) return {}
  return {
    why: typeof data.why === 'string' ? data.why : undefined,
    fix: typeof data.fix === 'string' ? data.fix : undefined,
    link: typeof data.link === 'string' ? data.link : undefined,
  }
}

/**
 * Create an evlog handle hook for SvelteKit.
 *
 * Add it to your `src/hooks.server.ts` using SvelteKit's `sequence` helper
 * or as the sole handle export.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { initLogger } from 'evlog'
 * import { evlog } from 'evlog/sveltekit'
 * import { createAxiomDrain } from 'evlog/axiom'
 *
 * initLogger({ env: { service: 'my-sveltekit-app' } })
 *
 * export const handle = evlog({
 *   drain: createAxiomDrain(),
 *   enrich: (ctx) => {
 *     ctx.event.region = process.env.FLY_REGION
 *   },
 * })
 * ```
 *
 * @example
 * ```ts
 * // Compose with other hooks using sequence
 * import { sequence } from '@sveltejs/kit/hooks'
 * import { evlog } from 'evlog/sveltekit'
 *
 * export const handle = sequence(evlog(), yourOtherHook)
 * ```
 */
export function evlog(options: EvlogSvelteKitOptions = {}): SvelteKitHandle {
  return async ({ event, resolve }) => {
    const { logger, finish, finishResponse, skipped, runWith } = integration.start(event, options)

    if (skipped) {
      return await resolve(event)
    }

    return runWith(async () => {
      try {
        const response = await resolve(event)

        // SvelteKit catches route errors internally and returns 500.
        // If handleError already logged an EvlogError with a specific status,
        // return a structured JSON response instead of SvelteKit's generic 500.
        const ctx = logger.getContext()
        const errorData = ctx.error
        if (response.status >= 500 && isContextEvlogError(errorData)) {
          const { status } = errorData
          await finish({ status })
          const body = serializeEvlogErrorResponse(evlogErrorFromContext(errorData), event.url.pathname)
          return new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          })
        }

        return finishResponse(response)
      } catch (error) {
        await finish({ error: error instanceof Error ? error : new Error(String(error)) })

        // Return structured JSON for EvlogError (like NextJS withEvlog / Nuxt errorHandler)
        if (EvlogError.isEvlogError(error)) {
          const status = error.status ?? 500
          const body = serializeEvlogErrorResponse(error, event.url.pathname)
          return new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          })
        }

        throw error
      }
    })
  }
}

/**
 * Create an evlog error handler for SvelteKit.
 *
 * Logs unhandled errors via `event.locals.log` (if available) and returns
 * structured error responses for `EvlogError` instances. Other errors keep
 * SvelteKit's own status and message. Supports SvelteKit 2 and 3.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { evlog, evlogHandleError } from 'evlog/sveltekit'
 *
 * export const handle = evlog()
 * export const handleError = evlogHandleError()
 * ```
 */
export function evlogHandleError(): SvelteKitHandleServerError {
  return (input) => {
    const { error, event } = input
    const logger = isRequestLogger(event.locals.log) ? event.locals.log : undefined

    if (logger && error instanceof Error) {
      logger.error(error)
    }

    const evlogError = error instanceof Error ? resolveEvlogError(error) : null

    if (evlogError) {
      const errorStatus = extractErrorStatus(evlogError)
      const response = serializeEvlogErrorResponse(evlogError, event.url.pathname)
      return {
        message: evlogError.message,
        status: errorStatus,
        ...readEvlogResponseData(response),
      }
    }

    // Kit 3 fills in status and message itself; its input getters for them are deprecated
    if ('kind' in input) return
    return { message: input.message, status: input.status }
  }
}

/**
 * Create both `handle` and `handleError` hooks in a single call.
 *
 * This is the recommended setup for SvelteKit — it returns both hooks
 * pre-configured and ready to export from `hooks.server.ts`.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { initLogger } from 'evlog'
 * import { createEvlogHooks } from 'evlog/sveltekit'
 * import { createAxiomDrain } from 'evlog/axiom'
 *
 * initLogger({ env: { service: 'my-app' } })
 *
 * export const { handle, handleError } = createEvlogHooks({
 *   drain: createAxiomDrain(),
 *   enrich: (ctx) => {
 *     ctx.event.region = process.env.FLY_REGION
 *   },
 * })
 * ```
 *
 * @example
 * ```ts
 * // Compose with other hooks using sequence
 * import { sequence } from '@sveltejs/kit/hooks'
 * import { createEvlogHooks } from 'evlog/sveltekit'
 *
 * const evlogHooks = createEvlogHooks()
 *
 * export const handle = sequence(evlogHooks.handle, yourOtherHook)
 * export const handleError = evlogHooks.handleError
 * ```
 */
export function createEvlogHooks(options: EvlogSvelteKitOptions = {}) {
  return {
    handle: evlog(options),
    handleError: evlogHandleError(),
  }
}
