import type { Exit } from 'effect'
import { Context, Effect, Option, Tracer } from 'effect'
import type { HttpServerResponse as Response } from 'effect/http'
import { Headers, HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse, HttpTraceContext } from 'effect/http'
import { extractErrorStatus } from '../shared/errors'
import type { ExtractedRequest } from '../shared/integration'
import { defineFrameworkIntegration } from '../shared/integration'
import type { BaseEvlogOptions } from '../shared/middleware'
import type { Unit } from './unit'
import { recordCause } from './cause'
import { EvlogLogger, TraceState, provideUnit, traceFields } from './unit'

/** Options accepted by the `evlog()` middleware and {@link withRequestLogger}. */
export type EvlogEffectOptions = BaseEvlogOptions

interface RequestInput extends ExtractedRequest {
  waitUntil: ((promise: Promise<unknown>) => void) | undefined
}

// No AsyncLocalStorage: the logger travels in the Effect context, so this
// integration runs on Cloudflare Workers without `nodejs_compat`.
const integration = defineFrameworkIntegration<RequestInput>({
  name: 'effect',
  extractRequest: input => input,
  attachLogger: () => {},
  extractWaitUntil: input => input.waitUntil,
})

/**
 * Start the wide event of one HTTP request. `statusOf` derives the response status
 * from the unit's exit once it settles.
 */
function startRequest<TSuccess>(
  input: RequestInput,
  span: Tracer.AnySpan,
  options: EvlogEffectOptions,
  statusOf: (exit: Exit.Exit<TSuccess, unknown>) => Effect.Effect<number>,
): Unit<TSuccess> | undefined {
  const { logger, finish, skipped } = integration.start(input, options)
  if (skipped) return undefined
  logger.set(traceFields(span))
  return {
    logger,
    finish: exit => Effect.flatMap(statusOf(exit), (status) => {
      if (exit._tag === 'Failure') recordCause(logger, exit.cause, { skipDefect: HttpServerResponse.isHttpServerResponse })
      return Effect.promise(() => finish({ status }))
    }),
  }
}

/**
 * Run `self` in a server span continuing the incoming trace, unless the server's
 * tracer middleware already opened one for this request.
 */
function withServerSpan<TSuccess, TError, TContext>(
  self: Effect.Effect<TSuccess, TError, TContext>,
  method: string,
  headers: Headers.Headers,
): Effect.Effect<TSuccess, TError, TContext> {
  return Effect.withFiber((fiber) => {
    const current = Context.getOption(fiber.context, Tracer.ParentSpan)
    const traced = Option.isSome(current) && current.value._tag === 'Span' && current.value.kind === 'server'
      ? self
      : Effect.withSpan(self, `http.server ${method}`, {
        kind: 'server',
        parent: Option.getOrUndefined(HttpTraceContext.fromHeaders(headers)),
      })
    const { tracestate } = headers
    return tracestate === undefined ? traced : Effect.provideService(traced, TraceState, tracestate)
  })
}

function pathOf(url: string): string {
  return new URL(url, 'http://localhost').pathname
}

/**
 * `effect/http` middleware: one wide event per request served by `HttpRouter` or
 * `HttpApi`, with the same options as every evlog framework integration.
 *
 * The event carries the request's `traceId` and `spanId`, continuing an incoming
 * W3C `traceparent`, and the status the client received, including the status of
 * a failure handled by Effect. Handlers read the event with `yield* EvlogLogger`.
 *
 * @example
 * ```ts
 * import { HttpRouter } from 'effect/http'
 * import { evlog } from 'evlog/effect'
 *
 * HttpServer.serve(app, evlog({ drain }))
 * ```
 */
export function evlog(options: EvlogEffectOptions = {}) {
  return <TError, TContext>(
    httpApp: Effect.Effect<Response.HttpServerResponse, TError, TContext>,
  ): Effect.Effect<Response.HttpServerResponse, TError, HttpServerRequest.HttpServerRequest | Exclude<TContext, EvlogLogger>> =>
    Effect.flatMap(Effect.service(HttpServerRequest.HttpServerRequest), (request) => {
      const unit = provideUnit(httpApp, (span, waitUntil) => startRequest(
        {
          method: request.method,
          path: pathOf(request.url),
          headers: request.headers,
          requestId: request.headers['x-request-id'],
          waitUntil: options.waitUntil ?? waitUntil,
        },
        span,
        options,
        exit => exit._tag === 'Success'
          ? Effect.succeed(exit.value.status)
          : Effect.map(HttpServerError.causeResponse(exit.cause), ([response]) => response.status),
      ))
      return withServerSpan(unit, request.method, request.headers)
    })
}

/**
 * Install {@link evlog} on every route of an `HttpRouter` (and `HttpApi`), providing
 * {@link EvlogLogger} to their handlers.
 *
 * @example
 * ```ts
 * const { handler } = HttpRouter.toWebHandler(Routes.pipe(Layer.provide(routerLayer({ drain }))))
 * ```
 */
export function routerLayer(options: EvlogEffectOptions = {}) {
  return HttpRouter.middleware<{ provides: EvlogLogger }>()(evlog(options), { global: true })
}

/**
 * Wrap the handling of a Fetch `Request` (a Cloudflare Worker or Durable Object
 * `fetch`, any Fetch-style runtime) as one wide event. The effect must produce the
 * `Response`; a failure is recorded with the status carried by the error, or 500.
 *
 * @example
 * ```ts
 * export class Room extends DurableObject {
 *   fetch(request: Request) {
 *     return Effect.runPromise(handle(request).pipe(withRequestLogger(request)))
 *   }
 * }
 * ```
 */
export function withRequestLogger(request: Request, options: EvlogEffectOptions = {}) {
  return <TError, TContext>(
    self: Effect.Effect<globalThis.Response, TError, TContext>,
  ): Effect.Effect<globalThis.Response, TError, Exclude<TContext, EvlogLogger>> => {
    const headers = Headers.fromInput(request.headers)
    const unit = provideUnit(self, (span, waitUntil) => startRequest(
      {
        method: request.method,
        path: pathOf(request.url),
        headers: request.headers,
        requestId: request.headers.get('x-request-id') ?? undefined,
        waitUntil: options.waitUntil ?? waitUntil,
      },
      span,
      options,
      exit => Effect.succeed(exit._tag === 'Success' ? exit.value.status : failureStatus(exit)),
    ))
    return withServerSpan(unit, request.method, headers)
  }
}

/** The status carried by the first failure (`status` / `statusCode`), 499 for a pure interruption. */
function failureStatus(exit: Exit.Failure<unknown, unknown>): number {
  for (const reason of exit.cause.reasons) {
    if (reason._tag === 'Fail') return extractErrorStatus(reason.error)
    if (reason._tag === 'Die') return extractErrorStatus(reason.defect)
  }
  return 499
}
