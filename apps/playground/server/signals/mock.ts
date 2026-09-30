import { answers, scriptedEvaluate } from '@evlog/signals/testing'

/** Stands in for the model when no gateway key is set. Reads the same fields a model would. */
export const mock = scriptedEvaluate((name, question, state) => {
  const text = JSON.stringify(state).toLowerCase()
  const status = (state as { status?: number }).status ?? 0

  switch (question.type) {
    case 'choice':
      if (name === 'fault') {
        if (status >= 500 && /econnreset|etimedout|fetch/.test(text)) return answers.choice(question, 'upstream', 0.93)
        if (/typeerror|cannot read/.test(text)) return answers.choice(question, 'us', 0.91)
        if (/must not contain/.test(text)) return answers.choice(question, 'us', 0.72)
        return answers.choice(question, status < 500 ? 'user' : 'us', 0.86)
      }
      return answers.first(question)
    case 'score':
      return /typeerror|cannot read/.test(text) ? answers.score(question, 2, 0.78) : answers.score(question, 1, 0.6)
    case 'boolean':
      switch (name) {
        case 'retryable': return answers.boolean(/econnreset|etimedout|timeout/.test(text) ? 0.9 : 0.08)
        case 'silent-failure': return answers.boolean(/"order"/.test(text) ? 0.04 : 0.93)
        case 'webhook-ignored': return answers.boolean(/"handled":false/.test(text) ? 0.95 : 0.03)
        case 'validation-bug': return answers.boolean(/must not contain/.test(text) ? 0.9 : 0.05)
        default: return answers.first(question)
      }
  }
}, 'mock (not jev)')
