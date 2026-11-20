import type { EnrichContext, EvlogPlugin, TailSamplingContext } from 'evlog'
import type { Signal, SignalInput, Verdict } from './define'
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

/** A verdict as written on the event. `kept` marks the signal that promoted it past sampling. */
export type SignalColumn = Verdict & { kept?: true }

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

  const cache = createLru<Verdict>(1_000)
  const inflight = new Map<string, Promise<Verdict | undefined>>()
  const pending = createLru<Judged>(1_000)
  const stats: SignalsStats = { calls: 0, skipped: 0, errors: 0, refused: 0, cached: 0, inputTokens: 0 }

  async function judge(signals: Signal[], input: SignalInput): Promise<Judged> {
    const verdicts = new Map<string, Verdict>()
    const shared: Array<[signal: Signal, verdict: Promise<Verdict | undefined>]> = []
    const toAsk: Array<[signal: Signal, cacheId: string | undefined]> = []
    for (const signal of signals) {
      const key = signal.cacheKey?.(input)
      const id = key === undefined ? undefined : `${signal.name}\0${key}`
      const hit = id === undefined ? undefined : cache.get(id)
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
      Promise.all(shared.map(([, verdict]) => verdict)),
    ])
    for (const [name, verdict] of fresh?.verdicts ?? []) verdicts.set(name, verdict)
    shared.forEach(([signal], i) => {
      const verdict = joined[i]
      if (!verdict) return
      verdicts.set(signal.name, verdict)
      stats.cached++
    })
    return { verdicts, modelId: fresh?.modelId }
  }

  // Registered before the call is awaited, so concurrent events with the same cache key join it instead of calling again.
  function ask(toAsk: Array<[signal: Signal, cacheId: string | undefined]>, input: SignalInput): Promise<Judged> {
    const call = callModel(toAsk, input)
    for (const [signal, id] of toAsk) {
      if (id === undefined) continue
      inflight.set(id, call.then(judged => judged.verdicts.get(signal.name)))
      void call.then(() => inflight.delete(id))
    }
    return call
  }

  async function callModel(toAsk: Array<[signal: Signal, cacheId: string | undefined]>, input: SignalInput): Promise<Judged> {
    const verdicts = new Map<string, Verdict>()
    const raw = buildState(input)
    const json = typeof raw === 'string' ? raw : JSON.stringify(raw)
    if (json.length > maxStateChars || !budget.take()) {
      stats.skipped++
      return { verdicts }
    }
    const state: SignalState = typeof raw === 'string' ? raw : JSON.parse(json)

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
        if (id !== undefined) cache.set(id, verdict)
      }
      budget.succeed()
      return { verdicts, modelId: response.modelId }
    } catch (err) {
      if (isRefusal(err)) {
        stats.refused++
        budget.succeed()
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
      const due = dueSignals(keepSignals, input)
      if (due.length === 0) return

      const judged = await judge(due, input)
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

// The AI SDK's own cross-version brand check; importing `Experimental_DecisionRefusalError` would fail to load on `ai` below 7.0.130.
const REFUSAL_MARKER = Symbol.for('vercel.ai.error.AI_DecisionRefusalError')

function isRefusal(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as Record<symbol, unknown>)[REFUSAL_MARKER] === true
}

function markKept(verdicts: Map<string, Verdict>, kept: Set<string>): Map<string, Verdict> {
  const out = new Map<string, Verdict>()
  for (const [name, verdict] of verdicts) {
    out.set(name, kept.has(name) ? { ...verdict, kept: true } as SignalColumn : verdict)
  }
  return out
}
