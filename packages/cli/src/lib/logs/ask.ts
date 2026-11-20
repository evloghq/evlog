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
  stats: SignalsStats
}

export interface AskOptions {
  /** Replace the model call: tests, and runs without a key. */
  evaluate?: EvaluateFn
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
 * per event, and rank the events by the probability of yes. The events are not
 * changed: each is judged on a copy.
 *
 * Unlike the plugin, which lets events through unjudged when the model fails,
 * a failed call stops the run: a ranking with holes in it reads as an answer.
 * A refusal only leaves that event out.
 */
export async function askEvents<T extends WideEvent>(events: T[], question: string, options: AskOptions = {}): Promise<AskResult<T>> {
  const [{ createSignals, defineSignal }, ai] = await load()
  const call: EvaluateFn = options.evaluate ?? (async (request) => {
    const result = await ai.experimental_decide({ ...request, state: request.state as Parameters<typeof ai.experimental_decide>[0]['state'], maxRetries: 1 })
    return { answers: result.answers, modelId: result.response.modelId, inputTokens: result.usage.inputTokens }
  })
  let failure: unknown
  // Errors never reach the plugin: its breaker would skip the remaining events, and a refusal is about one event only.
  const plugin = createSignals({
    signals: [defineSignal({ name: 'ask', ask: question })],
    timeoutMs: 15_000,
    budget: { perMinute: Math.max(1, events.length) },
    evaluate: async (request) => {
      try {
        return await call(request)
      } catch (error) {
        if (!ai.Experimental_DecisionRefusalError.isInstance(error)) failure = error
        return { answers: {}, modelId: '' }
      }
    },
  })

  const answered: Answered<T>[] = []
  for (const event of events) {
    const copy = { ...event } as WideEvent
    delete copy.signals
    await plugin.enrich({ event: copy, request: { path: typeof event.path === 'string' ? event.path : '' } })
    if (failure !== undefined) throw cliErrors.LOGS_ASK_FAILED({ reason: message(failure) })
    const verdict = (copy.signals as Record<string, { value: boolean, confidence: number }> | undefined)?.ask
    if (!verdict) continue
    // The column holds the confidence of the answer given; `1 - 0.97` would print as 0.030000000000000027.
    const probability = verdict.value ? verdict.confidence : 1 - verdict.confidence
    answered.push({ event, probability: Math.round(probability * 10_000) / 10_000 })
  }
  answered.sort((a, b) => b.probability - a.probability)
  return { answered, stats: plugin.stats() }
}
