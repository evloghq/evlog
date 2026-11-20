import { otelIntegration } from 'eve/instrumentation/otel'
import type { OtelIntegration, SpanProcessor } from 'eve/instrumentation/otel'

/** Where a turn's spans live: its trace, and the `invoke_agent` span its steps hang from. */
export interface TurnTrace {
  traceId: string
  spanId: string
}

interface EndedSpan {
  name?: string
  attributes?: Record<string, unknown>
  spanContext?: () => { traceId: string }
  /** SDK 2. */
  parentSpanContext?: { spanId: string }
  /** SDK 1. */
  parentSpanId?: string
}

/**
 * eve emits `invoke_agent` only after the turn settles, so its ids are read
 * from the turn's steps, which end before the `turn.settled` hook runs. The
 * instrumentation file and the extension are separate modules, so the map
 * lives on the process.
 */
const TURNS_KEY = Symbol.for('evlog.eve.turnTraces')
const MAX_TURNS = 1000

function turns(): Map<string, TurnTrace> {
  const global = globalThis as Record<symbol, Map<string, TurnTrace> | undefined>
  global[TURNS_KEY] ??= new Map()
  return global[TURNS_KEY]
}

/** The trace of the turn, once; `undefined` when no `evlogTraces()` processor saw it. */
export function takeTurnTrace(sessionId: string, turnId: string): TurnTrace | undefined {
  const key = `${sessionId}:${turnId}`
  const trace = turns().get(key)
  turns().delete(key)
  return trace
}

const processor: SpanProcessor = {
  onStart() {},
  onEnd(value) {
    const span = value as EndedSpan
    if (span.name !== 'agent.step') return
    const session = span.attributes?.['gen_ai.conversation.id']
    const turn = span.attributes?.['agent.turn.id']
    const parent = span.parentSpanContext?.spanId ?? span.parentSpanId
    const traceId = span.spanContext?.().traceId
    if (typeof session !== 'string' || typeof turn !== 'string' || !parent || !traceId) return
    const map = turns()
    map.set(`${session}:${turn}`, { traceId, spanId: parent })
    if (map.size > MAX_TURNS) map.delete(map.keys().next().value!)
  },
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
}

/**
 * Puts each turn's trace on its wide event: `traceId`, and `spanId` for the
 * turn's `invoke_agent` span, which the OTLP drain writes as the log record's
 * `trace_id` and `span_id`. Extensions cannot declare instrumentation, so the
 * agent exports it from a file of its own. It reads span ids only and exports
 * nothing.
 *
 * @example
 * ```ts
 * // agent/instrumentation/evlog.ts
 * import { evlogTraces } from '@evlog/eve/instrumentation'
 *
 * export default evlogTraces()
 * ```
 */
export function evlogTraces(): OtelIntegration {
  return otelIntegration({ spanProcessors: [processor] })
}
