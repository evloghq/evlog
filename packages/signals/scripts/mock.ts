import type { EvaluationQuestion } from '../src/evaluate'
import { answers, scriptedEvaluate } from '../src/testing'

type State = Record<string, unknown>
type Choice = Extract<EvaluationQuestion, { type: 'choice' }>
type Score = Extract<EvaluationQuestion, { type: 'score' }>

const get = (state: State, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v as State | undefined)?.[k], state)
const text = (state: State) => JSON.stringify(state).toLowerCase().replaceAll('\\"', '"')

/** Heuristic answers keyed on the demo catalog's signal names. For runs without a key only. */
export const mock = scriptedEvaluate((name, question, rawState) => {
  const state = (typeof rawState === 'string' ? JSON.parse(rawState) : rawState) as State
  const t = text(state)
  const status = get(state, 'status') as number | undefined
  const errorName = String(get(state, 'error.name') ?? '')

  switch (name) {
    case 'fault': {
      const q = question as Choice
      if (/econnreset|etimedout|fetcherror|upstream|rate limit/.test(t) && (status ?? 0) >= 500) return answers.choice(q, 'upstream', 0.93)
      if (/typeerror|referenceerror|cannot read/.test(t)) return answers.choice(q, 'app', 0.91)
      if (/must not contain "\+"/.test(t)) return answers.choice(q, 'app', 0.72)
      if (status === 400 || status === 401 || status === 403) return answers.choice(q, 'client', 0.9)
      return answers.choice(q, 'app', 0.5)
    }
    case 'severity':
      return /typeerror|cannot read/.test(t) ? answers.score(question as Score, 2, 0.78) : answers.score(question as Score, 1, 0.6)
    case 'retryable':
      return answers.boolean(/econnreset|etimedout|timeout|503|502/.test(t) || errorName === 'FetchError' ? 0.9 : 0.08)
    case 'silent-failure':
      return answers.boolean(get(state, 'order.id') !== undefined ? 0.04 : /fallback|requires_action|email you/.test(t) ? 0.93 : 0.4)
    case 'webhook-ignored':
      return answers.boolean(get(state, 'webhook.handled') === false ? 0.95 : 0.03)
    case 'slow-cause': {
      const dbMs = (get(state, 'db.totalMs') as number | undefined) ?? 0
      return dbMs > 1000 ? answers.choice(question as Choice, 'database', 0.88) : answers.choice(question as Choice, 'unknown', 0.5)
    }
    case 'validation-bug':
      return answers.boolean(/must not contain "\+"/.test(t) ? 0.9 : 0.05)
    case 'turn-resolved':
      return answers.boolean(/could not find|couldn't find|check your email/.test(t) ? 0.08 : 0.92)
    case 'turn-looping': {
      const tools = (get(state, 'tools') as Array<{ name: string }> | undefined) ?? []
      const repeated = tools.filter((tool, i) => tools.findIndex(o => JSON.stringify(o) === JSON.stringify(tool)) !== i).length
      return answers.boolean(repeated >= 2 ? 0.94 : 0.03)
    }
    case 'turn-off-script':
      return answers.boolean(0.02)
    case 'audit-review':
      return answers.boolean(/export|delete|role/.test(t) && !/admin/.test(String(get(state, 'audit.actor.role'))) ? 0.88 : 0.1)
    case 'job-flaky':
      return answers.boolean(/etimedout|econnreset/.test(t) ? 0.82 : 0.2)
    default:
      return answers.first(question)
  }
}, 'mock (not jev)')

export const mockEvaluate = mock.evaluate
