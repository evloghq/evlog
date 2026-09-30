import type { EvaluateFn, EvaluateRequest, EvaluationAnswer, EvaluationQuestion } from './evaluate'

export type { EvaluateRequest, EvaluationAnswer, EvaluationQuestion }

/** Produces one answer per question. Receives the question id, the question and the state. */
export type AnswerFn = (name: string, question: EvaluationQuestion, state: EvaluateRequest['state']) => EvaluationAnswer

export interface ScriptedEvaluate {
  evaluate: EvaluateFn
  /** Every request made, in order. */
  calls: EvaluateRequest[]
}

/**
 * An evaluate function that answers from a script instead of a model. Pass
 * it as `createSignals({ evaluate })` in tests, in playgrounds without a key,
 * or to replay recorded verdicts.
 *
 * @example
 * ```ts
 * const { evaluate, calls } = scriptedEvaluate((name, question) =>
 *   question.type === 'boolean' ? { type: 'boolean', probability: 0.9 } : answers.first(question),
 * )
 * ```
 */
export function scriptedEvaluate(answer: AnswerFn, modelId = 'scripted'): ScriptedEvaluate {
  const calls: EvaluateRequest[] = []
  return {
    calls,
    evaluate(request) {
      calls.push(request)
      const answers: Record<string, EvaluationAnswer> = {}
      for (const name in request.questions) answers[name] = answer(name, request.questions[name]!, request.state)
      return Promise.resolve({ answers, modelId, inputTokens: Math.ceil(JSON.stringify(request.state).length / 4) })
    },
  }
}

/** Answer builders with a full distribution, the shape a decision model returns. */
export const answers = {
  boolean(probability: number): EvaluationAnswer {
    return { type: 'boolean', probability }
  },
  choice(question: Extract<EvaluationQuestion, { type: 'choice' }>, pick: string, probability: number): EvaluationAnswer {
    const options = Object.keys(question.criteria)
    const rest = options.length > 1 ? (1 - probability) / (options.length - 1) : 0
    return { type: 'choice', choice: pick, probabilities: Object.fromEntries(options.map(o => [o, o === pick ? probability : rest])) }
  },
  score(question: Extract<EvaluationQuestion, { type: 'score' }>, level: number, probability: number): EvaluationAnswer {
    const levels = question.criteria.length
    const rest = (1 - probability) / (levels - 1)
    const probabilities = Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), i === level ? probability : rest]))
    const score = Object.entries(probabilities).reduce((sum, [i, p]) => sum + Number(i) * p, 0)
    return { type: 'score', score: Number(score.toFixed(2)), probabilities }
  },
  /** First option at 0.9, last level at 0.8, yes at 0.94. */
  first(question: EvaluationQuestion): EvaluationAnswer {
    switch (question.type) {
      case 'choice':
        return answers.choice(question, Object.keys(question.criteria)[0]!, 0.9)
      case 'score':
        return answers.score(question, question.criteria.length - 1, 0.8)
      case 'boolean':
        return answers.boolean(0.94)
    }
  },
}
