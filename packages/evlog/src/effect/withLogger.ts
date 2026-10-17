import type { Tracer } from 'effect'
import { Effect, Option } from 'effect'
import { Headers, HttpTraceContext } from 'effect/http'
import { createLogger } from '../logger'
import type { BaseEvlogOptions } from '../shared/middleware'
import { resolveMiddlewarePluginRunner, runEnrichAndDrain } from '../shared/middleware'
import type { TailSamplingContext } from '../types'
import { elapsedMs } from '../utils'
import type { EvlogLogger, Unit } from './unit'
import { recordCause } from './cause'
import { TraceState, provideUnit, traceFields } from './unit'

/** Options for {@link withLogger}. */
export interface WithLoggerOptions extends Pick<BaseEvlogOptions, 'drain' | 'enrich' | 'keep' | 'redact' | 'plugins' | 'waitUntil'> {
  /** Fields the wide event starts with. */
  fields?: Record<string, unknown>
  /**
   * Continue the trace of this W3C `traceparent` (a queue message, a Durable
   * Object call) instead of the current span. Malformed values start a new trace.
   */
  traceparent?: string
  /** W3C `tracestate` received with `traceparent`, forwarded on outgoing requests. */
  tracestate?: string
}

function startUnit(action: string, span: Tracer.AnySpan, options: WithLoggerOptions): Unit {
  const start = Date.now()
  const logger = createLogger({ ...options.fields, action, ...traceFields(span) }, { _deferDrain: true })
  return {
    logger,
    finish: exit => Effect.promise(async () => {
      if (exit._tag === 'Failure') recordCause(logger, exit.cause)
      const context = logger.getContext()
      const status = typeof context.status === 'number' ? context.status : undefined
      const duration = elapsedMs(start)
      const tail: TailSamplingContext = { status, duration, context, shouldKeep: false }
      await options.keep?.(tail)
      const runner = resolveMiddlewarePluginRunner(options)
      if (runner.hasKeep) await runner.runKeep(tail)
      const event = logger.emit({ _forceKeep: tail.shouldKeep, _durationMs: duration })
      if (event) await runEnrichAndDrain(event, options, undefined, status, runner)
    }),
  }
}

/**
 * Run an effect as its own unit of work (a job, a queue message, a Durable Object
 * alarm): one wide event is created, provided as {@link EvlogLogger}, and emitted when
 * the effect succeeds, fails or is interrupted, with the error taken from the `Cause`.
 *
 * The unit runs in a span named `action`, so the event carries `traceId` and
 * `spanId`, and every `HttpClient` call inside it propagates the same trace.
 * Sampling, redaction, enrichers and drains apply as for an HTTP request.
 *
 * @example
 * ```ts
 * const job = Effect.gen(function* () {
 *   const log = yield* EvlogLogger
 *   log.set({ users: { migrated: 120 } })
 * })
 *
 * await Effect.runPromise(job.pipe(withLogger('user-migration')))
 * ```
 */
export function withLogger(action: string, options: WithLoggerOptions = {}) {
  return <TSuccess, TError, TContext>(
    self: Effect.Effect<TSuccess, TError, TContext>,
  ): Effect.Effect<TSuccess, TError, Exclude<TContext, EvlogLogger>> => {
    const unit = provideUnit(self, (span, waitUntil) =>
      startUnit(action, span, { ...options, waitUntil: options.waitUntil ?? waitUntil }))
    const parent = options.traceparent
      ? Option.getOrUndefined(HttpTraceContext.w3c(Headers.fromRecordUnsafe({ traceparent: options.traceparent })))
      : undefined
    const traced = Effect.withSpan(unit, action, { parent })
    return options.tracestate === undefined ? traced : Effect.provideService(traced, TraceState, options.tracestate)
  }
}
