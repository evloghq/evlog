import { Context, Effect, Option, Tracer } from 'effect'
import type { HttpClient } from 'effect/http'
import { HttpClient as Client, HttpClientRequest } from 'effect/http'
import { TraceState } from './unit'

/**
 * W3C trace context headers (`traceparent`, and `tracestate` when one was
 * received) for the current span. Attach them to calls Effect's `HttpClient` does
 * not make, such as a Durable Object stub `fetch` or a queue message, so the next
 * hop's wide event joins the same trace. Empty outside a span.
 *
 * @example
 * ```ts
 * const headers = yield* traceHeaders
 * yield* Effect.promise(() => stub.fetch('https://room/join', { headers }))
 * ```
 */
export const traceHeaders: Effect.Effect<Record<string, string>> = Effect.withFiber((fiber) => {
  const span = Context.getOption(fiber.context, Tracer.ParentSpan)
  if (Option.isNone(span)) return Effect.succeed({})
  const { traceId, spanId, sampled } = span.value
  const headers: Record<string, string> = { traceparent: `00-${traceId}-${spanId}-${sampled ? '01' : '00'}` }
  const tracestate = fiber.getRef(TraceState)
  if (tracestate !== undefined) headers.tracestate = tracestate
  return Effect.succeed(headers)
})

/**
 * Forward the received W3C `tracestate` on every request of an `HttpClient`.
 * Effect's client already sends `traceparent` for the current span; this adds the
 * vendor state that has to travel with it.
 *
 * @example
 * ```ts
 * const client = withTracePropagation(yield* HttpClient.HttpClient)
 * ```
 */
export function withTracePropagation<TError, TContext>(
  client: HttpClient.HttpClient.With<TError, TContext>,
): HttpClient.HttpClient.With<TError, TContext> {
  return Client.mapRequestEffect(client, request => Effect.withFiber((fiber) => {
    const tracestate = fiber.getRef(TraceState)
    return Effect.succeed(tracestate === undefined ? request : HttpClientRequest.setHeader(request, 'tracestate', tracestate))
  }))
}
