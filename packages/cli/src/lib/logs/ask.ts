import type { WideEvent } from 'evlog'
import type { EvaluateFn, SignalsStats } from '@evlog/signals'
import { cliErrors } from '../errors'

/** An event with the model's probability that the answer to the question is yes. */
export interface Answered<T extends WideEvent = WideEvent> {
  event: T
  probability: number
}

export interface AskResult<T extends WideEvent = WideEvent> {
  /** Judged events, most likely yes first. Events the model declined to answer are left out. */
  answered: Answered<T>[]
  /** Events that took the verdict of an earlier event with the same fingerprint, without a call. */
  shared: number
  stats: SignalsStats
}

export interface AskOptions {
  /** Replace the model call: tests, and runs without a key. */
  evaluate?: EvaluateFn
  /** An AI Gateway id. Unset, `@evlog/signals` picks its default. */
  model?: string
}

/** What a run would cost before it makes a call: `--ask` with `--dry-run`. */
export interface AskEstimate {
  events: number
  /** Distinct fingerprints: one model call each. */
  calls: number
  /** The states sent plus each call's instructions and question, as typesafe-ai/jev counts them; other models tokenize differently. */
  inputTokens: number
}

/* Fitted to the input tokens typesafe-ai/jev reported for runs of 5 and 100 calls. */
const CALL_TOKENS = 270
const STATE_CHARS_PER_TOKEN = 1.7

const MAX_STRING = 256
const MAX_ITEMS = 10
const STACK_LINES = 3

/**
 * What the model reads for one event: the event minus its signal columns, with
 * every string cut at 256 characters, every array at 10 items and every stack
 * at its first 3 lines, each cut saying how much it left out. A request body or
 * a turn's tool list no longer decides the bill, and no field is dropped.
 */
export function askState(event: Record<string, unknown>): Record<string, unknown> {
  const { signals: _signals, signalsModel: _model, ...rest } = event
  return shrink(rest) as Record<string, unknown>
}

function shrink(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    if (key === 'stack') {
      const lines = value.split('\n')
      if (lines.length > STACK_LINES) return `${lines.slice(0, STACK_LINES).join('\n')}\n… ${lines.length - STACK_LINES} more lines`
    }
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… ${value.length - MAX_STRING} more characters` : value
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ITEMS).map(item => shrink(item))
    return value.length > MAX_ITEMS ? [...kept, `… ${value.length - MAX_ITEMS} more items`] : kept
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shrink(v, k)]))
  }
  return value
}

/** Unique to each event by construction, so never part of what a question is about. */
const PER_EVENT = new Set(['timestamp', 'requestId', 'idempotencyKey', 'traceId', 'spanId', 'parentSpanId'])
/** Measurements that vary by a few units between identical events. */
const MEASURED = /(?:^duration|Ms$|tokens$|Tokens$)/

/**
 * Events with the same fingerprint get one model call and share its verdict.
 * The CLI groups them itself rather than through a signal's `cacheKey`, whose
 * cache is bounded in entries and in time: a long run would ask again.
 * Only what is per-event by construction is left out (timestamps, request,
 * trace and span ids), and durations and token counts are floored to two
 * significant figures, so 412ms and 419ms match and 412ms and 490ms do not.
 * Every other value, ids a question can name included, must match exactly.
 */
export function askFingerprint(state: Record<string, unknown>): string {
  return JSON.stringify(state, (key, value) => {
    if (PER_EVENT.has(key)) return undefined
    // The printed form of durationMs, as in "412ms".
    if (key === 'duration' && typeof value === 'string') return undefined
    if (typeof value === 'number' && MEASURED.test(key) && value >= 100) {
      const step = 10 ** (Math.floor(Math.log10(value)) - 1)
      return Math.floor(value / step) * step
    }
    return value
  })
}

/** The events by fingerprint, in the order each fingerprint first appears. */
function groupByFingerprint<T extends WideEvent>(events: T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const event of events) {
    const key = askFingerprint(askState(event))
    const group = groups.get(key)
    if (group) group.push(event)
    else groups.set(key, [event])
  }
  return [...groups.values()]
}

/** Calls and tokens the events would cost, without loading the model packages. */
export function estimateAsk(events: WideEvent[]): AskEstimate {
  const groups = groupByFingerprint(events)
  const chars = groups.reduce((sum, [event]) => sum + JSON.stringify(askState(event!)).length, 0)
  const inputTokens = Math.round(groups.length * CALL_TOKENS + chars / STATE_CHARS_PER_TOKEN)
  return { events: events.length, calls: groups.length, inputTokens }
}

async function load(): Promise<[typeof import('@evlog/signals'), typeof import('ai')]> {
  try {
    return await Promise.all([import('@evlog/signals'), import('ai')])
  } catch (error) {
    throw cliErrors.LOGS_ASK_UNAVAILABLE({ reason: error instanceof Error ? error.message : String(error) })
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Ask a yes/no question about each event with `@evlog/signals`, one model call
 * per fingerprint ({@link askFingerprint}), and rank the events by the probability of yes. The events are not
 * changed: each is judged on a copy.
 *
 * Unlike the plugin, which lets events through unjudged when the model fails,
 * a failed call, or an event too large to send, stops the run: a ranking with
 * holes in it reads as an answer.
 * A refusal only leaves that event out.
 */
export async function askEvents<T extends WideEvent>(events: T[], question: string, options: AskOptions = {}): Promise<AskResult<T>> {
  const [{ createSignals, defineSignal }, ai] = await load()
  const call: EvaluateFn = options.evaluate ?? (async (request) => {
    const result = await ai.experimental_decide({ ...request, state: request.state as Parameters<typeof ai.experimental_decide>[0]['state'], maxRetries: 1 })
    return { answers: result.answers, modelId: result.response.modelId, inputTokens: result.usage.inputTokens }
  })
  let failure: unknown
  let refused = false
  // Errors never reach the plugin: its breaker would skip the remaining events, and a refusal is about one event only.
  const plugin = createSignals({
    signals: [defineSignal({ name: 'ask', ask: question })],
    state: askState,
    model: options.model,
    timeoutMs: 15_000,
    budget: { perMinute: Math.max(1, events.length) },
    evaluate: async (request) => {
      try {
        return await call(request)
      } catch (error) {
        if (ai.Experimental_DecisionRefusalError.isInstance(error)) refused = true
        else failure = error
        return { answers: {}, modelId: '' }
      }
    },
  })

  const answered: Answered<T>[] = []
  const groups = groupByFingerprint(events)
  for (const group of groups) {
    const event = group[0]!
    const copy = { ...event } as WideEvent
    delete copy.signals
    refused = false
    const skipped = plugin.stats().skipped
    await plugin.enrich({ event: copy, request: { path: typeof event.path === 'string' ? event.path : '' } })
    if (failure !== undefined) throw cliErrors.LOGS_ASK_FAILED({ reason: message(failure) })
    const verdict = (copy.signals as Record<string, { value: boolean, confidence: number }> | undefined)?.ask
    if (!verdict) {
      if (refused) continue
      const reason = plugin.stats().skipped > skipped
        ? `the event ${typeof event.requestId === 'string' ? `${event.requestId} ` : ''}is over 100000 characters of JSON once cut down, more than @evlog/signals sends`
        : 'the model returned no answer'
      throw cliErrors.LOGS_ASK_FAILED({ reason })
    }
    // The column holds the confidence of the answer given; `1 - 0.97` would print as 0.030000000000000027.
    const probability = verdict.value ? verdict.confidence : 1 - verdict.confidence
    const rounded = Math.round(probability * 10_000) / 10_000
    for (const member of group) answered.push({ event: member, probability: rounded })
  }
  answered.sort((a, b) => b.probability - a.probability)
  return { answered, shared: events.length - groups.length, stats: plugin.stats() }
}
