import { isSpanContextValid, trace } from '@opentelemetry/api'
import { definePlugin, type EvlogPlugin } from '../shared/plugin'

/**
 * Attach the active OpenTelemetry span to every request's wide event.
 *
 * When the request starts, the plugin reads the span that OpenTelemetry has active
 * (for example the server span created by `@opentelemetry/instrumentation-http`) and
 * sets `traceId` and `spanId` on the event. The OTLP drain writes them to the log
 * record's `trace_id` and `span_id`, so a backend links the event to its trace.
 *
 * Without an active, valid span the fields are left out. A `traceId` or `spanId`
 * already on the event is kept.
 *
 * Requires `@opentelemetry/api` 1.9 or later, which every OpenTelemetry JS SDK 2 and
 * SDK 3 app already installs.
 *
 * @example
 * ```ts
 * import { evlog } from 'evlog/hono'
 * import { createOtelPlugin } from 'evlog/otel'
 *
 * app.use(evlog({ plugins: [createOtelPlugin()] }))
 * ```
 */
export function createOtelPlugin(): EvlogPlugin {
  return definePlugin({
    name: 'otel',
    onRequestStart({ logger }) {
      const spanContext = trace.getActiveSpan()?.spanContext()
      if (!spanContext || !isSpanContextValid(spanContext)) return
      const context = logger.getContext()
      const fields: Record<string, string> = {}
      if (context.traceId === undefined) fields.traceId = spanContext.traceId
      if (context.spanId === undefined) fields.spanId = spanContext.spanId
      logger.set(fields)
    },
  })
}
