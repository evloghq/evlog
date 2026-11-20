import { Experimental_DecisionRefusalError } from 'ai'
import type { EnrichContext, EvlogPlugin, TailSamplingContext } from 'evlog'
import type { Signal, SignalColumn, SignalInput, Verdict } from './define'
import type { EvaluateFn, EvaluationModel, EvaluationQuestion, ProviderOptions, SignalState } from './evaluate'
import { createBudget } from './budget'
import { createLru } from './cache'
import { aiSdkEvaluate, toQuestion, toVerdict } from './evaluate'

export interface SignalsOptions {
  signals: Signal[]
  /**
   * AI SDK evaluation model: a gateway id or a provider instance.
   * @default 'typesafe-ai/jev'
   */
  model?: EvaluationModel
  /** Shared across all signals. Over budget, events pass through unjudged. */
  budget?: {
    /** @default 600 */
    perMinute?: number
    /** Pause after a failed call, in milliseconds. @default 30000 */
    cooldownMs?: number
  }
  /**
   * How long a verdict cached by `cacheKey` is reused, in milliseconds. Past
   * it, the next event with that key asks the model again, so an outage that
   * cleared stops reading as one. @default 300000
   */
  cacheTtlMs?: number
  /** Per-call timeout, in milliseconds. @default 2000 */
  timeoutMs?: number
  /**
   * What the model reads. Defaults to the whole event minus signal columns.
   * Pick fields to bound tokens and what leaves the process.
   */
  state?: (event: SignalInput) => SignalState
  /**
   * Largest state sent, in characters of JSON. Larger events are skipped
   * instead of failing the call for everyone. @default 100000
   */
  maxStateChars?: number
  /** Passed through to the model call, e.g. `{ gateway: { zeroDataRetention: true } }`. */
  providerOptions?: ProviderOptions
  /** Replace the model call. Used by tests and replay tooling. */
  evaluate?: EvaluateFn
  /**
   * Write the id of the model that answered on `event.signalsModel`. Off by
   * default: one more column on every judged event, useful only while
   * comparing models. @default false
   */
  stampModel?: boolean
}

export interface SignalsStats {
  /** Model calls made. */
  calls: number
  /** Events with due signals that were not judged: budget, breaker or state size. */
  skipped: number
  /** Model calls that failed or timed out. */
  errors: number
  /** Model calls the model declined to answer. They record no verdict and do not open the breaker. */
  refused: number
  /** Verdicts served from `cacheKey` without a call. */
  cached: number
  inputTokens: number
}

export interface SignalsPlugin extends EvlogPlugin {
  keep: (ctx: TailSamplingContext) => Promise<void>
  enrich: (ctx: EnrichContext) => Promise<void>
  stats: () => SignalsStats
}

interface Judged {
  verdicts: Map<string, Verdict>
  modelId?: string
}

function dueSignals(signals: Signal[], input: SignalInput): Signal[] {
  return signals.filter(s => !s.when || s.when(input))
}

function defaultState(event: SignalInput): SignalState {
  const { signals: _signals, signalsModel: _model, ...rest } = event
  return rest
}

/**
 * Register signals as one evlog plugin. Every matching signal for an event
 * goes into a single model call: the state is billed once and takes one slot
 * of the rate limit, whatever the number of questions.
 *
 * Keep signals run before sampling and can only promote. Verdicts land on
 * `event.signals`, and with `stampModel` the model id on `event.signalsModel`. Any failure, budget
 * exhaustion or timeout leaves the event as it was.
 *
 * @example
 * ```ts
 * export default defineEvlog({
 *   plugins: [
 *     createSignals({
 *       budget: { perMinute: 600 },
 *       signals: [fault, silentFailure],
 *     }),
 *   ],
 * })
 * ```
 */
export function createSignals(options: SignalsOptions): SignalsPlugin {
  const model = options.model ?? 'typesafe-ai/jev'
  const timeoutMs = options.timeoutMs ?? 2_000
  const maxStateChars = options.maxStateChars ?? 100_000
  const buildState = options.state ?? defaultState
  const evaluate = options.evaluate ?? aiSdkEvaluate
  const cacheTtlMs = options.cacheTtlMs ?? 300_000
  const budget = createBudget({
    perMinute: options.budget?.perMinute ?? 600,
    cooldownMs: options.budget?.cooldownMs ?? 30_000,
  })

  const seen = new Set<string>()
  for (const signal of options.signals) {
    if (seen.has(signal.name)) throw new Error(`[evlog/signals] duplicate signal name "${signal.name}"`)
    seen.add(signal.name)
  }
  const keepSignals = options.signals.filter(s => s.keep)

  const cache = createLru<{ verdict: Verdict, expiresAt: number }>(1_000)
  const inflight = new Map<string, Promise<Judged | undefined>>()
  const pending = createLru<Judged>(1_000)
  const stats: SignalsStats = { calls: 0, skipped: 0, errors: 0, refused: 0, cached: 0, inputTokens: 0 }

  async function judge(signals: Signal[], input: SignalInput): Promise<Judged> {
    const verdicts = new Map<string, Verdict>()
    const shared: Array<[signal: Signal, call: Promise<Judged | undefined>]> = []
    const toAsk: Array<[signal: Signal, cacheId: string | undefined]> = []
    for (const signal of signals) {
      const key = signal.cacheKey?.(input)
      const id = key === undefined ? undefined : `${signal.name}\0${key}`
      const entry = id === undefined ? undefined : cache.get(id)
      const hit = entry && entry.expiresAt > Date.now() ? entry.verdict : undefined
      const running = id === undefined ? undefined : inflight.get(id)
      if (hit) {
        verdicts.set(signal.name, hit)
        stats.cached++
      } else if (running) {
        shared.push([signal, running])
      } else {
        toAsk.push([signal, id])
      }
    }

    const [fresh, joined] = await Promise.all([
      toAsk.length > 0 ? ask(toAsk, input) : undefined,
      Promise.all(shared.map(([, call]) => call)),
    ])
    let modelId = fresh?.modelId
    for (const [name, verdict] of fresh?.verdicts ?? []) verdicts.set(name, verdict)
    shared.forEach(([signal], i) => {
      const verdict = joined[i]?.verdicts.get(signal.name)
      if (!verdict) return
      verdicts.set(signal.name, verdict)
      modelId ??= joined[i]!.modelId
      stats.cached++
    })
    return { verdicts, modelId }
  }

  // Registered before the call is awaited, so concurrent events with the same cache key join it instead of calling again.
  // Only calls that reach the model are registered: a skip belongs to this event's state, not to its key.
  function ask(toAsk: Array<[signal: Signal, cacheId: string | undefined]>, input: SignalInput): Promise<Judged> {
    const raw = buildState(input)
    const json = typeof raw === 'string' ? raw : JSON.stringify(raw)
    if (json.length > maxStateChars || !budget.take()) {
      stats.skipped++
      return Promise.resolve({ verdicts: new Map() })
    }
    const call = callModel(toAsk, typeof raw === 'string' ? raw : JSON.parse(json))
    // The caller gets the rejection; events that joined get no verdict, and the entry is cleared either way so the next event can retry.
    const settled = call.catch(() => undefined)
    for (const [, id] of toAsk) {
      if (id === undefined) continue
      inflight.set(id, settled)
      void settled.then(() => inflight.delete(id))
    }
    return call
  }

  async function callModel(toAsk: Array<[signal: Signal, cacheId: string | undefined]>, state: SignalState): Promise<Judged> {
    const verdicts = new Map<string, Verdict>()

    const questions: Record<string, EvaluationQuestion> = {}
    for (const [signal] of toAsk) questions[signal.name] = toQuestion(signal)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await evaluate({ model, state, questions, abortSignal: controller.signal, providerOptions: options.providerOptions })
      stats.calls++
      stats.inputTokens += response.inputTokens ?? 0
      for (const [signal, id] of toAsk) {
        const answer = response.answers[signal.name]
        if (!answer) continue
        const verdict = toVerdict(signal, answer)
        verdicts.set(signal.name, verdict)
        if (id !== undefined) cache.set(id, { verdict, expiresAt: Date.now() + cacheTtlMs })
      }
      budget.succeed()
      return { verdicts, modelId: response.modelId }
    } catch (err) {
      if (Experimental_DecisionRefusalError.isInstance(err)) {
        stats.refused++
        return { verdicts }
      }
      stats.errors++
      budget.fail()
      console.warn('[evlog/signals] model call failed, events pass through unjudged:', err)
      return { verdicts }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    name: 'signals',
    stats: () => ({ ...stats }),

    async keep(ctx: TailSamplingContext) {
      const input: SignalInput = { ...ctx.context }
      if (ctx.status !== undefined) input.status = ctx.status
      if (ctx.duration !== undefined) input.durationMs = ctx.duration
      input.path ??= ctx.path
      input.method ??= ctx.method
      const due = dueSignals(keepSignals, input)
      if (due.length === 0) return

      // The state is billed once per call and output is free, so the other due signals ride along instead of costing a second call in enrich.
      const judged = await judge(dueSignals(options.signals, input), input)
      const kept = new Set<string>()
      for (const signal of due) {
        const verdict = judged.verdicts.get(signal.name)
        if (verdict && signal.keep!(verdict)) kept.add(signal.name)
      }
      if (kept.size > 0) ctx.shouldKeep = true
      if (typeof input.requestId === 'string' && judged.verdicts.size > 0) {
        pending.set(input.requestId, { ...judged, verdicts: markKept(judged.verdicts, kept) })
      }
    },

    async enrich({ event }: EnrichContext) {
      const due = dueSignals(options.signals, event)
      if (due.length === 0) return

      const requestId = typeof event.requestId === 'string' ? event.requestId : undefined
      const prior = requestId === undefined ? undefined : pending.get(requestId)
      if (requestId !== undefined) pending.delete(requestId)

      const remaining = due.filter(s => !prior?.verdicts.has(s.name))
      const fresh = remaining.length > 0 ? await judge(remaining, event) : undefined

      const columns: Record<string, SignalColumn> = {}
      for (const signal of due) {
        const verdict = prior?.verdicts.get(signal.name) ?? fresh?.verdicts.get(signal.name)
        if (verdict) columns[signal.name] = verdict
      }
      if (Object.keys(columns).length === 0) return

      event.signals = { ...(event.signals as Record<string, SignalColumn> | undefined), ...columns }
      if (!options.stampModel) return
      const modelId = fresh?.modelId ?? prior?.modelId
      if (modelId) event.signalsModel = modelId
    },
  }
}

function markKept(verdicts: Map<string, Verdict>, kept: Set<string>): Map<string, Verdict> {
  const out = new Map<string, Verdict>()
  for (const [name, verdict] of verdicts) {
    out.set(name, kept.has(name) ? { ...verdict, kept: true } as SignalColumn : verdict)
  }
  return out
}
