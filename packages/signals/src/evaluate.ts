import type { Experimental_EvaluationAnswer, Experimental_EvaluationModel, Experimental_EvaluationQuestion, JSONValue } from 'ai'
import { experimental_evaluate } from 'ai'
import type { Signal, Verdict } from './define'

export type EvaluationModel = Experimental_EvaluationModel
export type EvaluationQuestion = Experimental_EvaluationQuestion
export type EvaluationAnswer = Experimental_EvaluationAnswer<EvaluationQuestion>

/** JSON the model can read. Built from the event by {@link SignalsOptions.state}. */
export type SignalState = string | Record<string, unknown>

export interface EvaluateRequest {
  model: EvaluationModel
  state: SignalState
  questions: Record<string, EvaluationQuestion>
  abortSignal: AbortSignal
  providerOptions?: ProviderOptions
}

/** Provider-specific options forwarded to the model call, keyed by provider (`gateway`, `typesafe-ai`). */
export type ProviderOptions = Record<string, Record<string, JSONValue>>

export interface EvaluateResponse {
  answers: Record<string, EvaluationAnswer>
  modelId: string
  inputTokens?: number
}

/**
 * The one call this package makes. Defaults to the AI SDK's
 * `experimental_evaluate`; replace it in tests or to record and replay.
 */
export type EvaluateFn = (request: EvaluateRequest) => Promise<EvaluateResponse>

export const aiSdkEvaluate: EvaluateFn = async (request) => {
  const result = await experimental_evaluate({
    model: request.model,
    state: request.state as Parameters<typeof experimental_evaluate>[0]['state'],
    questions: request.questions,
    abortSignal: request.abortSignal,
    providerOptions: request.providerOptions,
    maxRetries: 0,
  })
  return {
    answers: result.answers,
    modelId: result.response.modelId,
    inputTokens: result.usage.inputTokens,
  }
}

export function toQuestion(signal: Signal): EvaluationQuestion {
  switch (signal.kind) {
    case 'choice':
      return { type: 'choice', instructions: signal.ask, criteria: signal.choice! }
    case 'score':
      return { type: 'score', instructions: signal.ask, criteria: signal.score! }
    case 'boolean':
      return { type: 'boolean', instructions: signal.ask, criteria: signal.criteria }
  }
}

function argmax(probabilities: Record<string, number>): [key: string, probability: number] {
  let best: [string, number] | undefined
  for (const key in probabilities) {
    const p = probabilities[key]!
    if (!best || p > best[1]) best = [key, p]
  }
  return best!
}

/**
 * Map an AI SDK answer to a column. `confidence` is set from the probability
 * distribution; a prompted model that returns none yields `value` alone.
 */
export function toVerdict(signal: Signal, answer: EvaluationAnswer): Verdict {
  switch (answer.type) {
    case 'boolean': {
      const value = answer.probability >= 0.5
      return { value, confidence: value ? answer.probability : 1 - answer.probability }
    }
    case 'choice': {
      const confidence = answer.probabilities?.[answer.choice]
      return confidence === undefined ? { value: answer.choice } : { value: answer.choice, confidence }
    }
    case 'score': {
      const levels = signal.score!
      if (!answer.probabilities) {
        const index = Math.min(levels.length - 1, Math.max(0, Math.round(answer.score)))
        return { value: levels[index]!, score: answer.score }
      }
      const [index, confidence] = argmax(answer.probabilities)
      return { value: levels[Number(index)]!, score: answer.score, confidence }
    }
  }
}
