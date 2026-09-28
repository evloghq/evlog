import type { EveEvalResult, EveEvalRunSummary } from 'eve/evals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendBatchToPostHogEvents } from 'evlog/posthog'
import { MODEL } from '../../agent/lib/model'
import { PostHogReporter, resolveRunIdentity, toEvalEvent, toRunEvent } from './posthog'

vi.mock('evlog/posthog', () => ({ sendBatchToPostHogEvents: vi.fn() }))

const send = vi.mocked(sendBatchToPostHogEvents)

const identity = { runId: '42', model: 'deepseek/deepseek-v4-flash', commit: 'abc1234', branch: 'main' }

function evalResult(overrides: Partial<EveEvalResult> = {}): EveEvalResult {
  return {
    id: 'budget/no-fan-out',
    result: { output: null, finalMessage: null, sessionId: 'sess_1' },
    assertions: [],
    verdict: 'passed',
    startedAt: '2026-08-10T12:00:00.000Z',
    completedAt: '2026-08-10T12:00:04.500Z',
    ...overrides,
  } as EveEvalResult
}

function assertion(name: string, passed: boolean) {
  // `errored` distinguishes an assertion failure from the evaluator crashing
  // while scoring; eve added it with the verdict changes.
  return { name, score: passed ? 1 : 0, severity: 'gate', passed, errored: false } as const
}

describe('toEvalEvent', () => {
  it('records the eval outcome and its duration', () => {
    const event = toEvalEvent(evalResult(), identity)

    expect(event.evalId).toBe('budget/no-fan-out')
    expect(event.verdict).toBe('passed')
    expect(event.durationMs).toBe(4500)
    expect(event.level).toBe('info')
  })

  it('carries the eve session id that joins to the llm traces', () => {
    const event = toEvalEvent(evalResult(), identity)

    expect(event.eveSessionId).toBe('sess_1')
  })

  it('names the failed assertions and raises the level', () => {
    const event = toEvalEvent(evalResult({
      verdict: 'failed',
      assertions: [assertion('succeeded', true), assertion('maxToolCalls', false)],
    }), identity)

    expect(event.level).toBe('error')
    expect(event.assertions).toBe(2)
    expect(event.assertionsFailed).toBe(1)
    expect(event.failedAssertions).toBe('maxToolCalls')
  })

  it('omits the failure fields on a clean eval', () => {
    const event = toEvalEvent(evalResult({ assertions: [assertion('succeeded', true)] }), identity)

    expect(event).not.toHaveProperty('failedAssertions')
    expect(event).not.toHaveProperty('error')
  })

  it('stamps the run identity so runs stay comparable', () => {
    const event = toEvalEvent(evalResult(), identity)

    expect(event).toMatchObject(identity)
  })
})

describe('toRunEvent', () => {
  const summary = {
    target: { kind: 'local', url: 'http://localhost:3000', capabilities: { devRoutes: true } },
    results: [evalResult(), evalResult()],
    startedAt: '2026-08-10T12:00:00.000Z',
    completedAt: '2026-08-10T12:01:00.000Z',
    passed: 1,
    failed: 1,
    scored: 0,
    skipped: 0,
    errored: 0,
  } as EveEvalRunSummary

  it('rolls the run up with its verdict counts', () => {
    const event = toRunEvent(summary, identity)

    expect(event).toMatchObject({ evals: 2, passed: 1, failed: 1, durationMs: 60_000, target: 'local' })
  })

  it('reports a run with failures as an error', () => {
    expect(toRunEvent(summary, identity).level).toBe('error')
    expect(toRunEvent({ ...summary, failed: 0 }, identity).level).toBe('info')
  })
})

describe('PostHogReporter', () => {
  const summary = {
    target: { kind: 'local', url: 'http://localhost:3000', capabilities: { devRoutes: true } },
    results: [],
    startedAt: '2026-08-10T12:00:00.000Z',
    completedAt: '2026-08-10T12:01:00.000Z',
    passed: 1,
    failed: 0,
    scored: 0,
    skipped: 0,
    errored: 0,
  } as EveEvalRunSummary

  beforeEach(() => {
    send.mockReset()
    send.mockResolvedValue(undefined)
    process.env.POSTHOG_API_KEY = 'phc_test'
  })

  afterEach(() => {
    delete process.env.POSTHOG_API_KEY
    vi.restoreAllMocks()
  })

  async function run() {
    const reporter = PostHogReporter(identity)
    await reporter.onRunStart([], summary.target)
    await reporter.onEvalComplete(evalResult())
    await reporter.onEvalComplete(evalResult({ id: 'safety/no-push-to-main' }))
    await reporter.onRunComplete(summary)
  }

  it('sends the evals it collected, then the run rollup', async () => {
    await run()

    expect(send).toHaveBeenCalledTimes(2)
    const [evals, evalConfig] = send.mock.calls[0]!
    expect(evals.map(event => event.evalId)).toEqual(['budget/no-fan-out', 'safety/no-push-to-main'])
    expect(evalConfig).toMatchObject({ apiKey: 'phc_test', eventName: 'evi_eval' })

    const [runEvents, runConfig] = send.mock.calls[1]!
    expect(runEvents).toHaveLength(1)
    expect(runConfig).toMatchObject({ eventName: 'evi_eval_run' })
  })

  it('reads the api key at report time, not at construction', async () => {
    delete process.env.POSTHOG_API_KEY
    const reporter = PostHogReporter(identity)
    await reporter.onEvalComplete(evalResult())

    // eve loads the environment files after importing evals.config.ts.
    process.env.POSTHOG_API_KEY = 'phc_late'
    await reporter.onRunComplete(summary)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0]![1]).toMatchObject({ apiKey: 'phc_late' })
  })

  it('stays silent without an api key', async () => {
    delete process.env.POSTHOG_API_KEY

    await run()

    expect(send).not.toHaveBeenCalled()
  })

  it('never lets a failed upload fail the run', async () => {
    send.mockRejectedValue(new Error('posthog down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(run()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
  })
})

describe('resolveRunIdentity', () => {
  it('reads the run, commit and branch from the CI environment', () => {
    const resolved = resolveRunIdentity({
      GITHUB_RUN_ID: '99',
      GITHUB_SHA: 'abcdef1234567890',
      GITHUB_REF_NAME: 'feat/x',
    } as NodeJS.ProcessEnv)

    expect(resolved).toEqual({
      runId: '99',
      model: MODEL,
      commit: 'abcdef1',
      branch: 'feat/x',
    })
  })

  it('falls back to a local identity outside CI', () => {
    const resolved = resolveRunIdentity({} as NodeJS.ProcessEnv)

    expect(resolved.runId).toBe('local')
    // The resolved model, so a run is comparable even with no override set.
    expect(resolved.model).toBe(MODEL)
    expect(resolved).not.toHaveProperty('commit')
  })
})
