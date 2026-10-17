import type { Exit } from 'effect'
import { Context, Effect, Option, Tracer } from 'effect'
import type { AuditableLogger } from '../audit'
import type { FieldContext } from '../types'
import { noopLogger } from '../logger'

/**
 * The evlog logger of the current unit of work, building its wide event: the same
 * logger every other integration hands to its handlers (`set`, `error`, `warn`,
 * `info`, `audit`, …).
 *
 * Provided by {@link withLogger}, {@link withRequestLogger} and the `evlog()` HTTP
 * middleware. Read it with `yield* EvlogLogger` or {@link useLogger}.
 */
export class EvlogLogger extends Context.Service<EvlogLogger, AuditableLogger>()('evlog/effect/EvlogLogger') {}

type WaitUntilFn = (promise: Promise<unknown>) => void

/**
 * The platform `waitUntil` for the current unit of work (Cloudflare Workers
 * `ExecutionContext#waitUntil`, Vercel `waitUntil`, …). When set, drains run after
 * the unit settles instead of being awaited by it.
 *
 * Provide it per request, e.g. through the context argument of
 * `HttpRouter.toWebHandler`'s handler, or with `Effect.provideService`.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const WaitUntil = Context.Reference<WaitUntilFn | undefined>('evlog/effect/WaitUntil', {
  defaultValue: () => undefined,
})

/**
 * The W3C `tracestate` received with the current unit of work, forwarded on
 * outgoing requests next to `traceparent`.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const TraceState = Context.Reference<string | undefined>('evlog/effect/TraceState', {
  defaultValue: () => undefined,
})

/**
 * Access the logger of the current unit of work, typed with your own fields.
 *
 * @example
 * ```ts
 * interface CheckoutFields { cart: { items: number }, user: { id: string } }
 *
 * const program = Effect.gen(function* () {
 *   const log = yield* useLogger<CheckoutFields>()
 *   log.set({ cart: { items: 3 } })
 * })
 * ```
 */
export function useLogger<T extends object = Record<string, unknown>>(): Effect.Effect<AuditableLogger<T>, never, EvlogLogger> {
  return Effect.map(Effect.service(EvlogLogger), logger => logger as unknown as AuditableLogger<T>)
}

/**
 * Merge fields into the current wide event. Does nothing outside a unit of work,
 * like `Effect.annotateCurrentSpan` outside a span, so library code can call it
 * without requiring `EvlogLogger`.
 *
 * @example
 * ```ts
 * yield* set({ cart: { items: 3, total: 9999 } })
 * ```
 */
export function set<T extends object = Record<string, unknown>>(fields: FieldContext<T>): Effect.Effect<void> {
  return Effect.flatMap(Effect.serviceOption(EvlogLogger), logger =>
    Option.isSome(logger) ? Effect.sync(() => logger.value.set(fields as FieldContext<Record<string, unknown>>)) : Effect.void)
}

/** @internal A started unit of work: its logger and how to end it. */
export interface Unit<TSuccess = unknown> {
  logger: AuditableLogger
  finish: (exit: Exit.Exit<TSuccess, unknown>) => Effect.Effect<void>
}

/** @internal Trace fields for the wide event, from the unit's span. */
export function traceFields(span: Tracer.AnySpan): Record<string, string> {
  const fields: Record<string, string> = { traceId: span.traceId, spanId: span.spanId }
  if (span._tag === 'Span' && Option.isSome(span.parent)) fields.parentSpanId = span.parent.value.spanId
  return fields
}

/**
 * @internal Run `self` as a unit of work. `open` receives the unit's span and the
 * request's `waitUntil` and returns the started unit, or `undefined` when the unit
 * is filtered out (the effect then runs against a no-op logger).
 */
export function provideUnit<TSuccess, TError, TContext>(
  self: Effect.Effect<TSuccess, TError, TContext>,
  open: (span: Tracer.AnySpan, waitUntil: WaitUntilFn | undefined) => Unit<TSuccess> | undefined,
): Effect.Effect<TSuccess, TError, Exclude<TContext, EvlogLogger>> {
  return Effect.withFiber((fiber) => {
    const span = Context.getUnsafe(fiber.context, Tracer.ParentSpan)
    const unit = open(span, fiber.getRef(WaitUntil))
    if (!unit) return Effect.provideService(self, EvlogLogger, noopLogger)
    return self.pipe(
      Effect.provideService(EvlogLogger, unit.logger),
      Effect.onExit(exit => unit.finish(exit)),
    )
  })
}
