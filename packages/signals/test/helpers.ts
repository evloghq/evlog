import type { AnswerFn } from '../src/testing'
import { answers, scriptedEvaluate } from '../src/testing'

export const fakeEvaluate = scriptedEvaluate

/** Choices pick the first option at 0.9, scores the last level at 0.8, booleans say yes at 0.94. */
export const yes: AnswerFn = (_name, question) => answers.first(question)

export const no: AnswerFn = (name, question, state) => {
  const answer = yes(name, question, state)
  return answer.type === 'boolean' ? answers.boolean(0.06) : answer
}
