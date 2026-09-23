import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HookContext, HookEventMap } from 'eve/hooks'
import { initLogger } from '../src/logger'
import {
  resetEvlogEveForTests,
  defineEvlogHook,
  defineEvlogInstrumentation,
  evlogRuntimeContext,
  useLogger,
  detachActiveTurnLoggerForTests,
} from '../src/eve/index'
import {
  assertDrainCalledWith,
  assertEnrichBeforeDrain,
  assertWideEventShape,
  createPipelineSpies,
  findEventViaDrain,
  waitForDrainCalls,
} from './helpers/framework'

const SESSION_ID = 'sess_abc'
const TURN_ID = 'turn_0'
const TURN_ID_1 = 'turn_1'

function hookContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    agent: { name: 'test-agent' },
    channel: { kind: 'http' },
    session: { id: SESSION_ID },
    ...overrides,
  } as HookContext
}

function toolContext(turnId = TURN_ID) {
  return {
    session: {
      id: SESSION_ID,
      turn: { id: turnId },
    },
  }
}

/**
 * The turn's logger is gone. `useLogger` degrades to a detached logger and
 * warns instead of throwing, so instrumentation can never fail its caller.
 */
function expectDetachedLogger(ctx?: ReturnType<typeof toolContext>): void {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const log = ctx === undefined ? useLogger() : useLogger(ctx)
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('found no logger'))
  expect(log.emit()).toBeNull()
  warn.mockRestore()
}

async function runTurn(
  hook: ReturnType<typeof defineEvlogHook>,
  options: {
    turnId?: string
    fail?: boolean
    cancel?: boolean
    steps?: number
    toolResults?: Array<{
      toolName: string
      callId?: string
      status: 'completed' | 'failed' | 'rejected'
      delayMs?: number
    }>
    toolRequests?: Array<{ toolName: string, callId: string }>
    message?: string
    messageParts?: HookEventMap['message.received']['data']['parts']
    inputRequests?: Array<{ requestId: string, toolName: string, prompt: string }>
    subagents?: Array<{ phase: 'called' | 'completed', callId: string, name: string }>
    costUsd?: number
    stepFailures?: Array<{ code: string, message: string, stepIndex: number }>
    authorizations?: Array<{
      name: string
      outcome?: HookEventMap['authorization.completed']['data']['outcome']
      reason?: string
    }>
    compactions?: Array<{ modelId: string, usageInputTokens: number | null, complete?: boolean }>
    clearContext?: boolean
    reasoning?: string[]
    response?: string | null
    result?: HookEventMap['result.completed']['data']['result']
    ctx?: HookContext
  } = {},
) {
  const turnId = options.turnId ?? TURN_ID
  const ctx = options.ctx ?? hookContext()
  const events = hook.events!

  events['turn.started']!({
    type: 'turn.started',
    data: { sequence: 0, turnId },
  }, ctx)

  if (options.message !== undefined) {
    events['message.received']!({
      type: 'message.received',
      data: {
        message: options.message,
        ...(options.messageParts ? { parts: options.messageParts } : {}),
        sequence: 1,
        turnId,
      },
    }, ctx)
  }

  const stepCount = options.steps ?? 1
  for (let i = 0; i < stepCount; i++) {
    events['step.completed']!({
      type: 'step.completed',
      data: {
        finishReason: i === stepCount - 1 ? 'stop' : 'tool-calls',
        sequence: 2 + i,
        stepIndex: i,
        turnId,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 10,
          ...(options.costUsd !== undefined ? { costUsd: options.costUsd } : {}),
        },
      },
    }, ctx)
  }

  for (const failure of options.stepFailures ?? []) {
    events['step.failed']!({
      type: 'step.failed',
      data: { ...failure, sequence: 4, turnId },
    }, ctx)
  }

  for (const [index, auth] of (options.authorizations ?? []).entries()) {
    events['authorization.required']!({
      type: 'authorization.required',
      data: {
        description: `sign in to ${auth.name}`,
        name: auth.name,
        sequence: 30 + index,
        stepIndex: 0,
        turnId,
      },
    }, ctx)
    if (auth.outcome) {
      events['authorization.completed']!({
        type: 'authorization.completed',
        data: {
          name: auth.name,
          outcome: auth.outcome,
          ...(auth.reason ? { reason: auth.reason } : {}),
          sequence: 31 + index,
          stepIndex: 0,
          turnId,
        },
      }, ctx)
    }
  }

  for (const [index, compaction] of (options.compactions ?? []).entries()) {
    events['compaction.requested']!({
      type: 'compaction.requested',
      data: {
        modelId: compaction.modelId,
        sequence: 40 + index,
        sessionId: SESSION_ID,
        turnId,
        usageInputTokens: compaction.usageInputTokens,
      },
    }, ctx)
    if (compaction.complete !== false) {
      events['compaction.completed']!({
        type: 'compaction.completed',
        data: { modelId: compaction.modelId, sequence: 41 + index, sessionId: SESSION_ID, turnId },
      }, ctx)
    }
  }

  if (options.clearContext) {
    events['context.cleared']!({
      type: 'context.cleared',
      data: { sequence: 45, sessionId: SESSION_ID, turnId },
    }, ctx)
  }

  for (const [index, reasoning] of (options.reasoning ?? []).entries()) {
    events['reasoning.completed']!({
      type: 'reasoning.completed',
      data: { reasoning, sequence: 50 + index, stepIndex: 0, turnId },
    }, ctx)
  }

  if (options.response !== undefined) {
    events['message.completed']!({
      type: 'message.completed',
      data: { finishReason: 'stop', message: options.response, sequence: 55, stepIndex: 0, turnId },
    }, ctx)
  }

  if (options.result !== undefined) {
    events['result.completed']!({
      type: 'result.completed',
      data: { result: options.result, sequence: 56, stepIndex: 0, turnId },
    }, ctx)
  }

  for (const [index, req] of (options.toolRequests ?? []).entries()) {
    events['actions.requested']!({
      type: 'actions.requested',
      data: {
        actions: [
          {
            callId: req.callId,
            kind: 'tool-call',
            toolName: req.toolName,
            input: {},
          },
        ],
        sequence: 5 + index,
        stepIndex: 0,
        turnId,
      },
    }, ctx)
  }

  for (const [index, req] of (options.inputRequests ?? []).entries()) {
    events['input.requested']!({
      type: 'input.requested',
      data: {
        requests: [
          {
            requestId: req.requestId,
            prompt: req.prompt,
            action: {
              callId: `call_${req.toolName}`,
              kind: 'tool-call',
              toolName: req.toolName,
              input: {},
            },
          },
        ],
        sequence: 7 + index,
        stepIndex: 0,
        turnId,
      },
    }, ctx)
  }

  for (const [index, sub] of (options.subagents ?? []).entries()) {
    if (sub.phase === 'called') {
      events['subagent.called']!({
        type: 'subagent.called',
        data: {
          callId: sub.callId,
          childSessionId: `child_${sub.callId}`,
          sessionId: SESSION_ID,
          sequence: 20 + index,
          name: sub.name,
          toolName: 'delegate',
          turnId,
          workflowId: 'wf_1',
        },
      }, ctx)
    } else {
      events['subagent.completed']!({
        type: 'subagent.completed',
        data: {
          callId: sub.callId,
          output: 'done',
          subagentName: sub.name,
        },
      }, ctx)
    }
  }

  for (const [index, tool] of (options.toolResults ?? []).entries()) {
    if (tool.delayMs) await new Promise(r => setTimeout(r, tool.delayMs))
    events['action.result']!({
      type: 'action.result',
      data: {
        result: {
          callId: tool.callId ?? `call_${tool.toolName}`,
          kind: 'tool-result',
          toolName: tool.toolName,
          output: {},
        },
        sequence: 10 + index,
        stepIndex: 0,
        status: tool.status,
        turnId,
        ...(tool.status === 'failed'
          ? { error: { code: 'TOOL_FAILED', message: 'tool broke' } }
          : {}),
      },
    }, ctx)
  }

  if (options.cancel) {
    await events['turn.cancelled']!({
      type: 'turn.cancelled',
      data: { sequence: 99, turnId },
    }, ctx)
  } else if (options.fail) {
    await events['turn.failed']!({
      type: 'turn.failed',
      data: {
        code: 'TURN_ERROR',
        message: 'turn exploded',
        sequence: 99,
        turnId,
      },
    }, ctx)
  } else {
    await events['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 99, turnId },
    }, ctx)
  }
}

describe('evlog/eve', () => {
  beforeEach(() => {
    resetEvlogEveForTests()
    initLogger({ env: { service: 'eve-test' } })
  })

  afterEach(() => {
    resetEvlogEveForTests()
  })

  it('creates a turn logger on turn.started with session context', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID))
    expect(event).toBeDefined()
    expect(event?.method).toBe('EVE')
    expect(event?.eve).toMatchObject({
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnSequence: 0,
    })
    expect(event?.agent).toMatchObject({ name: 'test-agent' })
    expect(event?.channel).toMatchObject({ kind: 'http' })
  })

  it('qualifies requestId with the session, since turn ids restart at 0', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.requestId).toBe(`${SESSION_ID}:${TURN_ID}`)
  })

  it('accumulates token usage across multiple steps', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, { steps: 2 })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.ai).toMatchObject({
      calls: 2,
      steps: 2,
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 20,
      totalTokens: 300,
      finishReason: 'stop',
    })
  })

  it('records tool executions with duration from actions.requested', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, {
      toolRequests: [{ toolName: 'get_weather', callId: 'call_weather' }],
      toolResults: [
        { toolName: 'get_weather', callId: 'call_weather', status: 'completed', delayMs: 15 },
        { toolName: 'search', callId: 'call_search', status: 'failed' },
      ],
    })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.ai?.tools?.[0]?.name).toBe('get_weather')
    expect(event?.ai?.tools?.[0]?.durationMs).toBeGreaterThan(0)
    expect(event?.ai?.tools?.[1]).toEqual({
      name: 'search',
      durationMs: 0,
      success: false,
      error: 'tool broke',
    })
  })

  it('attributes input tokens to the tool result that added them', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()
    const events = hook.events!

    events['turn.started']!({ type: 'turn.started', data: { sequence: 0, turnId: TURN_ID } }, ctx)
    events['step.completed']!({
      type: 'step.completed',
      data: { finishReason: 'tool-calls', sequence: 1, stepIndex: 0, turnId: TURN_ID, usage: { inputTokens: 5_000, outputTokens: 50 } },
    }, ctx)
    events['action.result']!({
      type: 'action.result',
      data: { result: { callId: 'call_pages', kind: 'tool-result', toolName: 'docs__list-pages', output: {} }, sequence: 2, stepIndex: 0, status: 'completed', turnId: TURN_ID },
    }, ctx)
    events['step.completed']!({
      type: 'step.completed',
      data: { finishReason: 'tool-calls', sequence: 3, stepIndex: 1, turnId: TURN_ID, usage: { inputTokens: 70_000, outputTokens: 50 } },
    }, ctx)
    events['action.result']!({
      type: 'action.result',
      data: { result: { callId: 'call_weather', kind: 'tool-result', toolName: 'get_weather', output: {} }, sequence: 4, stepIndex: 1, status: 'completed', turnId: TURN_ID },
    }, ctx)
    events['step.completed']!({
      type: 'step.completed',
      data: { finishReason: 'stop', sequence: 5, stepIndex: 2, turnId: TURN_ID, usage: { inputTokens: 72_000, outputTokens: 120 } },
    }, ctx)
    await events['turn.completed']!({ type: 'turn.completed', data: { sequence: 6, turnId: TURN_ID } }, ctx)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.ai?.tools?.[0]).toMatchObject({
      name: 'docs__list-pages',
      inputTokens: 65_000,
    })
    expect(event?.ai?.tools?.[1]).toMatchObject({
      name: 'get_weather',
      inputTokens: 2_000,
    })
  })

  it('splits a step input delta across parallel tool results', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()
    const events = hook.events!

    events['turn.started']!({ type: 'turn.started', data: { sequence: 0, turnId: TURN_ID } }, ctx)
    events['step.completed']!({
      type: 'step.completed',
      data: { finishReason: 'tool-calls', sequence: 1, stepIndex: 0, turnId: TURN_ID, usage: { inputTokens: 1_000, outputTokens: 30 } },
    }, ctx)
    events['action.result']!({
      type: 'action.result',
      data: { result: { callId: 'call_a', kind: 'tool-result', toolName: 'search_a', output: {} }, sequence: 2, stepIndex: 0, status: 'completed', turnId: TURN_ID },
    }, ctx)
    events['action.result']!({
      type: 'action.result',
      data: { result: { callId: 'call_b', kind: 'tool-result', toolName: 'search_b', output: {} }, sequence: 3, stepIndex: 0, status: 'completed', turnId: TURN_ID },
    }, ctx)
    events['step.completed']!({
      type: 'step.completed',
      data: { finishReason: 'stop', sequence: 4, stepIndex: 1, turnId: TURN_ID, usage: { inputTokens: 3_000, outputTokens: 30 } },
    }, ctx)
    await events['turn.completed']!({ type: 'turn.completed', data: { sequence: 5, turnId: TURN_ID } }, ctx)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.ai?.tools?.[0]?.inputTokens).toBe(1_000)
    expect(event?.ai?.tools?.[1]?.inputTokens).toBe(1_000)
  })

  it('re-bases tool attribution after a compaction', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()
    const events = hook.events!

    events['turn.started']!({ type: 'turn.started', data: { sequence: 0, turnId: TURN_ID } }, ctx)
    events['step.completed']!({
      type: 'step.completed',
      data: { finishReason: 'tool-calls', sequence: 1, stepIndex: 0, turnId: TURN_ID, usage: { inputTokens: 5_000, outputTokens: 30 } },
    }, ctx)
    events['action.result']!({
      type: 'action.result',
      data: { result: { callId: 'call_big', kind: 'tool-result', toolName: 'big_search', output: {} }, sequence: 2, stepIndex: 0, status: 'completed', turnId: TURN_ID },
    }, ctx)
    events['compaction.requested']!({
      type: 'compaction.requested',
      data: { modelId: 'gpt-5-mini', sequence: 3, sessionId: SESSION_ID, turnId: TURN_ID, usageInputTokens: 40_000 },
    }, ctx)
    events['compaction.completed']!({
      type: 'compaction.completed',
      data: { modelId: 'gpt-5-mini', sequence: 4, sessionId: SESSION_ID, turnId: TURN_ID },
    }, ctx)
    events['step.completed']!({
      type: 'step.completed',
      data: { finishReason: 'stop', sequence: 5, stepIndex: 1, turnId: TURN_ID, usage: { inputTokens: 50_000, outputTokens: 30 } },
    }, ctx)
    await events['turn.completed']!({ type: 'turn.completed', data: { sequence: 6, turnId: TURN_ID } }, ctx)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    // big_search returned before the compaction; its linear contribution is gone
    expect(event?.ai?.tools?.[0]?.inputTokens).toBeUndefined()
  })

  it('emits a valid wide event on turn.completed', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    assertWideEventShape(event!)
    expect(event?.method).toBe('EVE')
    expect(event?.path).toBe(`/sessions/${SESSION_ID}/turns/${TURN_ID}`)
    expect(event?.status).toBe(200)
  })

  it('captures turn.failed as an error wide event', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, { fail: true })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.level).toBe('error')
    expect(event?.status).toBe(500)
    expect(event?.eve?.failure).toMatchObject({
      code: 'TURN_ERROR',
      message: 'turn exploded',
    })
  })

  it('emits a cancelled turn as a non-error wide event', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, { cancel: true })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.status).toBe(499)
    expect(event?.level).toBe('info')
    expect(event?.eve).toMatchObject({ phase: 'cancelled', cancelled: true })
  })

  it('releases turn state after a cancelled turn', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, { cancel: true })

    expectDetachedLogger(toolContext())

    await runTurn(hook, { turnId: TURN_ID_1 })
    await waitForDrainCalls(spies.drain, 2)
    expect(findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID_1))).toBeDefined()
  })

  it('flushes an in-flight turn when the session fails without turn.failed', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)

    await hook.events!['session.failed']!({
      type: 'session.failed',
      data: { code: 'SESSION_ERROR', message: 'session exploded', sessionId: SESSION_ID },
    }, ctx)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.status).toBe(500)
    expect(event?.level).toBe('error')
    expect(event?.eve).toMatchObject({
      failure: { code: 'SESSION_ERROR', message: 'session exploded' },
    })
    expectDetachedLogger(toolContext())
  })

  it('drops session context once the session completes', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)
    useLogger(toolContext()).set({ customer: { slug: 'acme' } })

    await hook.events!['session.completed']!({ type: 'session.completed' }, ctx)

    await waitForDrainCalls(spies.drain)
    const openTurn = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID))
    expect(openTurn?.status).toBe(200)
    expectDetachedLogger(toolContext())

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID_1 },
    }, ctx)
    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 1, turnId: TURN_ID_1 },
    }, ctx)

    await waitForDrainCalls(spies.drain, 2)
    const secondTurn = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID_1))
    expect(secondTurn?.customer).toBeUndefined()
  })

  it('finishes the remaining turns and clears session state when one turn fails to finish', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({
      drain: spies.drain,
      keep: (tail) => {
        if (tail.path?.endsWith(TURN_ID)) throw new Error('keep exploded')
      },
    })
    const ctx = hookContext()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)
    useLogger(toolContext()).set({ customer: { slug: 'acme' } })
    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 1, turnId: TURN_ID_1 },
    }, ctx)

    await hook.events!['session.completed']!({ type: 'session.completed' }, ctx)

    await waitForDrainCalls(spies.drain)
    expect(findEventViaDrain(spies.drain, e => e.path?.endsWith(TURN_ID))).toBeUndefined()
    expect(findEventViaDrain(spies.drain, e => e.path?.endsWith(TURN_ID_1))).toBeDefined()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 2, turnId: 'turn_2' },
    }, ctx)
    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 3, turnId: 'turn_2' },
    }, ctx)

    await waitForDrainCalls(spies.drain, 2)
    const thirdTurn = findEventViaDrain(spies.drain, e => e.path?.endsWith('turn_2'))
    expect(thirdTurn?.customer).toBeUndefined()
  })

  it('records runtime identity from session.started on every turn', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()

    hook.events!['session.started']!({
      type: 'session.started',
      data: {
        runtime: {
          agentId: 'agent_1',
          agentName: 'support',
          eveVersion: '0.30.8',
          modelId: 'anthropic/claude-opus-5',
          build: { gitSha: 'abc123', gitBranch: 'main', deployedAt: '2026-08-05T00:00:00Z' },
        },
      },
    }, ctx)

    await runTurn(hook, { ctx })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve).toMatchObject({
      runtime: {
        version: '0.30.8',
        agentId: 'agent_1',
        model: 'anthropic/claude-opus-5',
        gitSha: 'abc123',
        gitBranch: 'main',
        deployedAt: '2026-08-05T00:00:00Z',
      },
    })
    expect(event?.ai).toMatchObject({ model: 'anthropic/claude-opus-5' })
  })

  it('records parent lineage for a subagent session', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = {
      ...hookContext(),
      session: {
        id: SESSION_ID,
        parent: {
          callId: 'call_delegate',
          rootSessionId: 'sess_root',
          sessionId: 'sess_parent',
          turn: { id: 'turn_parent' },
        },
      },
    } as HookContext

    hook.events!['session.started']!({
      type: 'session.started',
      data: {
        invocation: {
          kind: 'subagent',
          name: 'researcher',
          parentCallId: 'call_delegate',
          parentSessionId: 'sess_parent',
          parentTurnId: 'turn_parent',
        },
      },
    }, ctx)

    await runTurn(hook, { ctx })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve).toMatchObject({
      parent: {
        sessionId: 'sess_parent',
        rootSessionId: 'sess_root',
        callId: 'call_delegate',
        turnId: 'turn_parent',
        subagent: 'researcher',
      },
    })
  })

  it('records the caller principal that triggered the turn', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = {
      ...hookContext(),
      session: {
        id: SESSION_ID,
        auth: {
          current: {
            principalId: 'github:1234',
            principalType: 'user',
            authenticator: 'github',
            subject: 'someone@example.com',
            attributes: { login: 'someone' },
          },
          initiator: null,
        },
      },
    } as unknown as HookContext

    await runTurn(hook, { ctx })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve).toMatchObject({
      caller: {
        principalId: 'github:1234',
        principalType: 'user',
        authenticator: 'github',
      },
    })
  })

  it('keeps the caller subject and attributes off the event', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = {
      ...hookContext(),
      session: {
        id: SESSION_ID,
        auth: {
          current: {
            principalId: 'github:1234',
            principalType: 'user',
            authenticator: 'github',
            subject: 'someone@example.com',
            attributes: { login: 'someone' },
          },
          initiator: null,
        },
      },
    } as unknown as HookContext

    await runTurn(hook, { ctx })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    const { caller } = event?.eve as { caller?: Record<string, unknown> }
    expect(Object.keys(caller ?? {}).sort()).toEqual([
      'authenticator',
      'principalId',
      'principalType',
    ])
  })

  it('omits the caller when the session carries no authenticated principal', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve).not.toHaveProperty('caller')
  })

  it('prefers the cost reported by eve over the configured pricing map', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({
      drain: spies.drain,
      cost: { 'gpt-5': { input: 1000, output: 2000 } },
    })

    await runTurn(hook, { steps: 2, costUsd: 0.0125 })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.ai).toMatchObject({ costUsd: 0.025 })
    expect((event?.ai as Record<string, unknown>).estimatedCost).toBeUndefined()
  })

  it('records failed model steps on a turn that still completes', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, {
      stepFailures: [{ code: 'RATE_LIMIT', message: 'slow down', stepIndex: 0 }],
    })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.status).toBe(200)
    expect(event?.eve).toMatchObject({
      failedSteps: 1,
      stepFailures: [{ code: 'RATE_LIMIT', message: 'slow down', stepIndex: 0 }],
    })
  })

  it('records connection authorization outcomes', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, {
      authorizations: [{ name: 'linear', outcome: 'declined', reason: 'user said no' }],
    })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    const { authorizations } = (event?.eve as { authorizations?: Array<Record<string, unknown>> })
    expect(authorizations).toHaveLength(1)
    expect(authorizations?.[0]).toMatchObject({
      name: 'linear',
      outcome: 'declined',
      reason: 'user said no',
    })
    expect(authorizations?.[0]?.durationMs).toBeTypeOf('number')
  })

  it('marks a turn awaiting an authorization that never completed', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, { authorizations: [{ name: 'github' }] })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve).toMatchObject({ phase: 'awaiting-authorization' })
  })

  it('sizes the model reasoning without recording its content', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain, message: 'full' })

    await runTurn(hook, { reasoning: ['weighing the refund policy', 'checking the order'] })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve).toMatchObject({ reasoning: { blocks: 2, chars: 44 } })
    expect(JSON.stringify(event)).not.toContain('weighing the refund policy')
  })

  it('records the response length even when the message is omitted', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, { response: 'Refund issued for order 4821.' })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.message).toEqual({ responseChars: 29 })
  })

  it('records the response text once the message mode allows it', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain, message: 'preview', messagePreviewLength: 10 })

    await runTurn(hook, { response: 'x'.repeat(50) })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.message).toEqual({ responseChars: 50, response: `${'x'.repeat(10)}…` })
  })

  it('ignores a step that produced no assistant message', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain, message: 'full' })

    await runTurn(hook, { response: null })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.message).toBeUndefined()
  })

  it('records the structured result of an agent with an output schema', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, { result: { refunded: true, orderId: '4821' } })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve).toMatchObject({ result: { refunded: true, orderId: '4821' } })
  })

  it('records compaction and context clearing', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, {
      compactions: [{ modelId: 'gpt-5-mini', usageInputTokens: 180_000 }],
      clearContext: true,
    })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve).toMatchObject({
      compaction: { count: 1, model: 'gpt-5-mini', inputTokensAtTrigger: 180_000 },
      contextCleared: true,
    })
  })

  it('reports a compaction that was requested but never completed', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, {
      compactions: [{ modelId: 'gpt-5-mini', usageInputTokens: 180_000, complete: false }],
    })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve).toMatchObject({
      compaction: {
        count: 0,
        requested: 1,
        model: 'gpt-5-mini',
        inputTokensAtTrigger: 180_000,
      },
    })
  })

  it('keeps the first trigger when a turn compacts more than once', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, {
      compactions: [
        { modelId: 'gpt-5-mini', usageInputTokens: 180_000 },
        { modelId: 'gpt-5-nano', usageInputTokens: 90_000 },
      ],
    })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve).toMatchObject({
      compaction: { count: 2, model: 'gpt-5-mini', inputTokensAtTrigger: 180_000 },
    })
  })

  it('marks a subagent started and times it to completion', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()
    const events = hook.events!

    events['turn.started']!({ type: 'turn.started', data: { sequence: 0, turnId: TURN_ID } }, ctx)
    events['subagent.called']!({
      type: 'subagent.called',
      data: {
        callId: 'call_1',
        childSessionId: 'child_1',
        sessionId: SESSION_ID,
        sequence: 20,
        name: 'researcher',
        toolName: 'delegate',
        turnId: TURN_ID,
        workflowId: 'wf_1',
      },
    }, ctx)
    events['subagent.started']!({
      type: 'subagent.started',
      data: { callId: 'call_1', subagentName: 'researcher' },
    }, ctx)
    events['subagent.completed']!({
      type: 'subagent.completed',
      data: { callId: 'call_1', output: 'done', subagentName: 'researcher' },
    }, ctx)
    await events['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 99, turnId: TURN_ID },
    }, ctx)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    const { subagents } = (event?.eve as { subagents?: Array<Record<string, unknown>> })
    expect(subagents?.[0]).toMatchObject({ callId: 'call_1', status: 'completed' })
    expect(subagents?.[0]?.durationMs).toBeTypeOf('number')
  })

  it('summarizes attachment parts without their content in preview mode', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain, message: 'preview' })

    await runTurn(hook, {
      message: 'here is my passport',
      messageParts: [{ type: 'file', mediaType: 'application/pdf', filename: 'john-doe-passport.pdf', data: 'JVBER' },],
    })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.message).toEqual({
      received: 'here is my passport',
      parts: [{ type: 'file', mediaType: 'application/pdf' }],
    })
  })

  it('keeps attachment parts verbatim in full mode', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain, message: 'full' })

    await runTurn(hook, {
      message: 'x'.repeat(600),
      messageParts: [{ type: 'text', text: 'hello' }],
    })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    const message = event?.message as { received: string, parts: unknown[] }
    expect(message.received).toHaveLength(600)
    expect(message.parts).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('truncates the preview to messagePreviewLength', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain, message: 'preview', messagePreviewLength: 10 })

    await runTurn(hook, { message: 'x'.repeat(50) })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect((event?.message as { received: string }).received).toBe(`${'x'.repeat(10)}…`)
  })

  it('emits a session wide event rolling up every turn when sessionEvent is on', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain, sessionEvent: true })
    const ctx = hookContext()

    await runTurn(hook, { ctx, costUsd: 0.01, toolResults: [{ toolName: 'search', status: 'completed' }] })
    await runTurn(hook, { ctx, turnId: TURN_ID_1, cancel: true, costUsd: 0.02 })
    await hook.events!['session.completed']!({ type: 'session.completed' }, ctx)

    await waitForDrainCalls(spies.drain, 3)
    const sessionEvent = findEventViaDrain(spies.drain, e => e.path === `/sessions/${SESSION_ID}`)
    expect(sessionEvent?.eve).toMatchObject({
      scope: 'session',
      sessionId: SESSION_ID,
      turns: 2,
      cancelledTurns: 1,
    })
    expect(sessionEvent?.ai).toMatchObject({
      calls: 2,
      inputTokens: 200,
      outputTokens: 100,
      costUsd: 0.03,
      toolCalls: ['search'],
    })
  })

  it('counts a turn parked on an authorization as failed in the session rollup', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain, sessionEvent: true })
    const ctx = hookContext()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)
    hook.events!['authorization.required']!({
      type: 'authorization.required',
      data: {
        description: 'sign in to linear',
        name: 'linear',
        sequence: 1,
        stepIndex: 0,
        turnId: TURN_ID,
      },
    }, ctx)

    await hook.events!['session.failed']!({
      type: 'session.failed',
      data: { code: 'SESSION_ERROR', message: 'session exploded', sessionId: SESSION_ID },
    }, ctx)

    await waitForDrainCalls(spies.drain, 2)
    const turnEvent = findEventViaDrain(spies.drain, e => e.path?.endsWith(TURN_ID))
    expect(turnEvent?.eve).toMatchObject({ phase: 'awaiting-authorization' })

    const sessionEvent = findEventViaDrain(spies.drain, e => e.path === `/sessions/${SESSION_ID}`)
    expect(sessionEvent?.eve).toMatchObject({
      scope: 'session',
      sessionId: SESSION_ID,
      turns: 1,
      failedTurns: 1,
    })
  })

  it('rolls up the estimated cost when eve reports no cost', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({
      drain: spies.drain,
      sessionEvent: true,
      cost: { 'gpt-5': { input: 1000, output: 2000 } },
    })
    const ctx = hookContext()

    await runTurn(hook, { ctx })
    await hook.events!['session.completed']!({ type: 'session.completed' }, ctx)

    await waitForDrainCalls(spies.drain, 2)
    const sessionEvent = findEventViaDrain(spies.drain, e => e.path === `/sessions/${SESSION_ID}`)
    expect(sessionEvent?.ai).toMatchObject({ estimatedCost: 0.2 })
    expect((sessionEvent?.ai as Record<string, unknown>).costUsd).toBeUndefined()
  })

  it('reports both cost sources when a session mixes them', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({
      drain: spies.drain,
      sessionEvent: true,
      cost: { 'gpt-5': { input: 1000, output: 2000 } },
    })
    const ctx = hookContext()

    await runTurn(hook, { ctx, costUsd: 0.01 })
    await runTurn(hook, { ctx, turnId: TURN_ID_1 })
    await hook.events!['session.completed']!({ type: 'session.completed' }, ctx)

    await waitForDrainCalls(spies.drain, 3)
    const sessionEvent = findEventViaDrain(spies.drain, e => e.path === `/sessions/${SESSION_ID}`)
    expect(sessionEvent?.ai).toMatchObject({ costUsd: 0.01, estimatedCost: 0.2 })
  })

  it('emits no session wide event by default', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()

    await runTurn(hook, { ctx })
    await hook.events!['session.completed']!({ type: 'session.completed' }, ctx)

    await waitForDrainCalls(spies.drain)
    expect(findEventViaDrain(spies.drain, e => e.path === `/sessions/${SESSION_ID}`)).toBeUndefined()
  })

  it('does not throw when an internal handler fails', async () => {
    const hook = defineEvlogHook({
      enrich: () => {
        throw new Error('enrich exploded')
      },
      drain: vi.fn(),
    })

    await expect(runTurn(hook)).resolves.toBeUndefined()
  })

  it('useLogger returns the active turn logger via ctx', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)

    const log = useLogger(toolContext())
    log.set({ business: { tenant: 'acme' } })

    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 1, turnId: TURN_ID },
    }, ctx)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.business).toEqual({ tenant: 'acme' })
  })

  it('useLogger resolves from AsyncLocalStorage after turn.started', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)

    const log = useLogger()
    log.set({ business: { tenant: 'als-acme' } })

    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 1, turnId: TURN_ID },
    }, ctx)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.business).toEqual({ tenant: 'als-acme' })
  })

  it('useLogger resolves from the sole active turn without ctx or ALS', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)

    detachActiveTurnLoggerForTests()

    const log = useLogger()
    log.set({ business: { tenant: 'active-turn' } })

    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 1, turnId: TURN_ID },
    }, ctx)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.business).toEqual({ tenant: 'active-turn' })
  })

  it('useLogger degrades to a detached logger outside an active turn', () => {
    expectDetachedLogger()
  })

  it('degrades instead of throwing when the turn resumed in another process', () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, hookContext())

    // A resume elsewhere leaves the turn live with its process-local state gone.
    resetEvlogEveForTests()
    initLogger({ env: { service: 'eve-test' } })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = useLogger(toolContext())
    expect(() => log.set({ customer: { slug: 'acme' } })).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('resumed in another process'))
    warn.mockRestore()
  })

  it('warns once per turn while a resumed turn keeps calling useLogger', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    useLogger(toolContext())
    useLogger(toolContext())
    useLogger(toolContext())

    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('carries business context across turns in the same session', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)
    const log = useLogger(toolContext())
    log.set({
      customer: { slug: 'acme' },
      order: { id: '4821' },
    })
    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 1, turnId: TURN_ID },
    }, ctx)

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 1, turnId: TURN_ID_1 },
    }, ctx)
    const log2 = useLogger(toolContext(TURN_ID_1))
    log2.set({ refund: { amount: 890 } })
    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 2, turnId: TURN_ID_1 },
    }, ctx)

    await waitForDrainCalls(spies.drain, 2)
    const secondTurn = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID_1))
    expect(secondTurn?.customer).toEqual({ slug: 'acme' })
    expect(secondTurn?.order).toEqual({ id: '4821' })
    expect(secondTurn?.refund).toEqual({ amount: 890 })
  })

  it('records approval approved and tool duration after cross-turn resume', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()
    const events = hook.events!
    const callId = 'call_issue_refund'

    events['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)
    events['actions.requested']!({
      type: 'actions.requested',
      data: {
        actions: [
          {
            callId,
            kind: 'tool-call',
            toolName: 'issue_refund',
            input: {},
          },
        ],
        sequence: 1,
        stepIndex: 0,
        turnId: TURN_ID,
      },
    }, ctx)
    events['input.requested']!({
      type: 'input.requested',
      data: {
        requests: [
          {
            requestId: 'req_1',
            prompt: 'Approve refund of $890?',
            action: {
              callId,
              kind: 'tool-call',
              toolName: 'issue_refund',
              input: {},
            },
          },
        ],
        sequence: 2,
        stepIndex: 0,
        turnId: TURN_ID,
      },
    }, ctx)
    await events['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 3, turnId: TURN_ID },
    }, ctx)

    events['turn.started']!({
      type: 'turn.started',
      data: { sequence: 1, turnId: TURN_ID_1 },
    }, ctx)
    events['step.started']!({
      type: 'step.started',
      data: { sequence: 4, stepIndex: 0, turnId: TURN_ID_1 },
    }, ctx)
    await new Promise(r => setTimeout(r, 15))
    events['action.result']!({
      type: 'action.result',
      data: {
        result: {
          callId,
          kind: 'tool-result',
          toolName: 'issue_refund',
          output: {},
        },
        sequence: 5,
        stepIndex: 0,
        status: 'completed',
        turnId: TURN_ID_1,
      },
    }, ctx)
    await events['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 6, turnId: TURN_ID_1 },
    }, ctx)

    await waitForDrainCalls(spies.drain, 2)
    const firstTurn = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID))
    const secondTurn = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID_1))
    expect(firstTurn?.approval).toMatchObject({
      status: 'pending',
      tool: 'issue_refund',
    })
    expect(secondTurn?.approval).toMatchObject({
      status: 'approved',
      tool: 'issue_refund',
    })
    expect(secondTurn?.ai?.tools?.[0]?.durationMs).toBeGreaterThan(0)
  })

  it('consumes the matching callId when multiple pending approvals share a toolName', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()
    const events = hook.events!
    const callIdA = 'call_refund_a'
    const callIdB = 'call_refund_b'

    events['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)
    events['actions.requested']!({
      type: 'actions.requested',
      data: {
        actions: [
          { callId: callIdA, kind: 'tool-call', toolName: 'issue_refund', input: {} },
          { callId: callIdB, kind: 'tool-call', toolName: 'issue_refund', input: {} },
        ],
        sequence: 1,
        stepIndex: 0,
        turnId: TURN_ID,
      },
    }, ctx)
    events['input.requested']!({
      type: 'input.requested',
      data: {
        requests: [
          {
            requestId: 'req_a',
            prompt: 'Approve refund A?',
            action: { callId: callIdA, kind: 'tool-call', toolName: 'issue_refund', input: {} },
          },
          {
            requestId: 'req_b',
            prompt: 'Approve refund B?',
            action: { callId: callIdB, kind: 'tool-call', toolName: 'issue_refund', input: {} },
          },
        ],
        sequence: 2,
        stepIndex: 0,
        turnId: TURN_ID,
      },
    }, ctx)
    await events['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 3, turnId: TURN_ID },
    }, ctx)

    events['turn.started']!({
      type: 'turn.started',
      data: { sequence: 1, turnId: TURN_ID_1 },
    }, ctx)
    events['action.result']!({
      type: 'action.result',
      data: {
        result: {
          callId: callIdB,
          kind: 'tool-result',
          toolName: 'issue_refund',
          output: { refundId: 'rfnd_b' },
        },
        sequence: 4,
        stepIndex: 0,
        status: 'completed',
        turnId: TURN_ID_1,
      },
    }, ctx)
    await events['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 5, turnId: TURN_ID_1 },
    }, ctx)

    events['turn.started']!({
      type: 'turn.started',
      data: { sequence: 2, turnId: 'turn_2' },
    }, ctx)
    events['action.result']!({
      type: 'action.result',
      data: {
        result: {
          callId: callIdA,
          kind: 'tool-result',
          toolName: 'issue_refund',
          output: { refundId: 'rfnd_a' },
        },
        sequence: 6,
        stepIndex: 0,
        status: 'completed',
        turnId: 'turn_2',
      },
    }, ctx)
    await events['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 7, turnId: 'turn_2' },
    }, ctx)

    await waitForDrainCalls(spies.drain, 3)
    const secondTurn = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID_1))
    const thirdTurn = findEventViaDrain(spies.drain, e => e.path?.includes('turn_2'))

    expect(secondTurn?.approval).toMatchObject({ status: 'approved', tool: 'issue_refund' })
    expect(secondTurn?.ai?.tools?.[0]?.success).toBe(true)
    expect(thirdTurn?.approval).toMatchObject({ status: 'approved', tool: 'issue_refund' })
    expect(thirdTurn?.ai?.tools?.[0]?.success).toBe(true)
  })

  it('tracks session turn count and phase across approval turns', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()
    const events = hook.events!
    const callId = 'call_issue_refund'

    events['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)
    events['input.requested']!({
      type: 'input.requested',
      data: {
        requests: [
          {
            requestId: 'req_1',
            prompt: 'Approve refund of $890?',
            action: {
              callId,
              kind: 'tool-call',
              toolName: 'issue_refund',
              input: {},
            },
          },
        ],
        sequence: 1,
        stepIndex: 0,
        turnId: TURN_ID,
      },
    }, ctx)
    await events['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 2, turnId: TURN_ID },
    }, ctx)

    events['turn.started']!({
      type: 'turn.started',
      data: { sequence: 1, turnId: TURN_ID_1 },
    }, ctx)
    events['action.result']!({
      type: 'action.result',
      data: {
        result: {
          callId,
          kind: 'tool-result',
          toolName: 'issue_refund',
          output: {},
        },
        sequence: 3,
        stepIndex: 0,
        status: 'completed',
        turnId: TURN_ID_1,
      },
    }, ctx)
    await events['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 4, turnId: TURN_ID_1 },
    }, ctx)

    await waitForDrainCalls(spies.drain, 2)
    const firstTurn = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID))
    const secondTurn = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID_1))

    expect(firstTurn?.eve?.phase).toBe('awaiting-approval')
    expect(firstTurn?.eve?.sessionTurns).toBe(1)
    expect(secondTurn?.eve?.sessionTurns).toBe(2)
    expect(secondTurn?.approval).toMatchObject({ status: 'approved', tool: 'issue_refund' })
    expect(secondTurn?.path).toContain(TURN_ID_1)
    expect(firstTurn?.path).toContain(TURN_ID)
  })

  it('records approval pending and rejected tool results', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, {
      inputRequests: [
        {
          requestId: 'req_1',
          toolName: 'issue_refund',
          prompt: 'Approve refund of $890?',
        },
      ],
      toolResults: [
        {
          toolName: 'issue_refund',
          callId: 'call_issue_refund',
          status: 'rejected',
        },
      ],
    })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve?.phase).toBe('rejected')
    expect(event?.approval).toMatchObject({
      status: 'rejected',
      tool: 'issue_refund',
    })
    expect(event?.ai?.tools?.[0]).toMatchObject({
      name: 'issue_refund',
      success: false,
      error: 'rejected',
    })
  })

  it('estimates cost when cost map and model are configured', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({
      drain: spies.drain,
      cost: { 'anthropic/claude-sonnet-4.6': { input: 3, output: 15 } },
      model: 'anthropic/claude-sonnet-4.6',
    })

    await runTurn(hook)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.ai?.model).toBe('anthropic/claude-sonnet-4.6')
    expect(event?.ai?.estimatedCost).toBeGreaterThan(0)
  })

  it('records subagent.called and subagent.completed', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, {
      subagents: [
        { phase: 'called', callId: 'sub_1', name: 'researcher' },
        { phase: 'completed', callId: 'sub_1', name: 'researcher' },
      ],
    })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve?.subagents).toEqual([
      {
        callId: 'sub_1',
        name: 'researcher',
        toolName: 'delegate',
        childSessionId: 'child_sub_1',
        status: 'completed',
        output: 'done',
        durationMs: expect.any(Number),
      },
    ])
  })

  it('keep callback can force-keep failed tool turns', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({
      drain: spies.drain,
      keep: (ctx) => {
        const tools = (ctx.context.ai as { tools?: Array<{ success: boolean }> } | undefined)?.tools
        if (tools?.some(t => !t.success)) ctx.shouldKeep = true
      },
    })

    await runTurn(hook, {
      toolResults: [{ toolName: 'broken', status: 'failed' }],
    })

    await waitForDrainCalls(spies.drain)
    assertDrainCalledWith(spies.drain, {
      path: `/sessions/${SESSION_ID}/turns/${TURN_ID}`,
      method: 'EVE',
    })
  })

  it('runs enrich before drain', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({
      drain: spies.drain,
      enrich: spies.enrich,
    })

    await runTurn(hook)

    await waitForDrainCalls(spies.drain)
    assertEnrichBeforeDrain(spies.enrich, spies.drain)
  })

  it('enrichTurn runs once per turn with the eve session in scope', async () => {
    const spies = createPipelineSpies()
    const enrichTurn = vi.fn(() => ({
      caller: 'github:42',
      eve: { caller: { authenticator: 'github' } },
    }))
    const hook = defineEvlogHook({
      drain: spies.drain,
      enrichTurn,
    })
    const ctx = hookContext({
      session: {
        id: SESSION_ID,
        auth: {
          current: { principalId: 'github:42', principalType: 'user', authenticator: 'github' },
          initiator: null,
        },
        turn: { id: TURN_ID },
      },
    } as Partial<HookContext>)

    await runTurn(hook, { ctx })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(enrichTurn).toHaveBeenCalledTimes(1)
    expect(enrichTurn).toHaveBeenCalledWith({
      session: ctx.session,
      agent: ctx.agent,
      channel: ctx.channel,
    })
    expect(event?.caller).toBe('github:42')
    expect(event?.eve).toMatchObject({
      sessionId: SESSION_ID,
      caller: { authenticator: 'github' },
    })
  })

  it('does not throw when enrichTurn fails', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({
      drain: spies.drain,
      enrichTurn: () => {
        throw new Error('enrichTurn exploded')
      },
    })

    await expect(runTurn(hook)).resolves.toBeUndefined()

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.eve).toMatchObject({ sessionId: SESSION_ID })
  })

  it('keeps enrichTurn fields turn-scoped across turns of the same session', async () => {
    const spies = createPipelineSpies()
    let turn = 0
    const hook = defineEvlogHook({
      drain: spies.drain,
      enrichTurn: () => {
        turn += 1
        return turn === 1 ? { caller: 'github:42', tier: 'pro' } : { caller: 'github:43' }
      },
    })

    await runTurn(hook)
    await runTurn(hook, { turnId: TURN_ID_1 })

    await waitForDrainCalls(spies.drain, 2)
    const first = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID))
    const second = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID_1))
    expect(first?.tier).toBe('pro')
    expect(second?.caller).toBe('github:43')
    expect(second?.tier).toBeUndefined()
  })

  it('omits message.received content by default', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })

    await runTurn(hook, { message: 'secret user prompt' })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.message).toBeUndefined()
  })

  it('includes truncated message when redactMessage is false', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain, redactMessage: false })

    await runTurn(hook, { message: 'hello from user' })

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.message).toEqual({ received: 'hello from user' })
  })

  it('uses continuing instead of raw continuationToken', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext({
      channel: { kind: 'http', continuationToken: 'very-long-opaque-token-value' },
    })

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)
    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 1, turnId: TURN_ID },
    }, ctx)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.channel).toMatchObject({ kind: 'http', continuing: true })
    expect(event?.channel).not.toHaveProperty('continuationToken')
  })

  it('shares turn state across separate evlog/eve module instances (eve authored-module bundles)', async () => {
    const spies = createPipelineSpies()
    const hookModule = await import('../src/eve/index')
    hookModule.resetEvlogEveForTests()
    initLogger({ env: { service: 'eve-test' } })

    const hook = hookModule.defineEvlogHook({ drain: spies.drain })
    const ctx = hookContext()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)

    vi.resetModules()
    const toolModule = await import('../src/eve/index')
    const log = toolModule.useLogger(toolContext())
    log.set({ business: { tenant: 'acme' } })

    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 1, turnId: TURN_ID },
    }, ctx)

    await waitForDrainCalls(spies.drain)
    const event = findEventViaDrain(spies.drain, () => true)
    expect(event?.business).toEqual({ tenant: 'acme' })

    const fresh = await import('../src/eve/index')
    fresh.resetEvlogEveForTests()
  })

  it('clears turn state when finish fails', async () => {
    const hook = defineEvlogHook({
      drain: () => {
        throw new Error('drain unavailable')
      },
    })

    await runTurn(hook)

    expectDetachedLogger(toolContext())
  })

  it('evicts oldest sessions when maxSessions is exceeded', async () => {
    const spies = createPipelineSpies()
    const hook = defineEvlogHook({ drain: spies.drain, maxSessions: 1 })
    const ctx = hookContext()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: 'turn_old' },
    }, { ...ctx, session: { id: 'sess_old' } })
    useLogger({ session: { id: 'sess_old', turn: { id: 'turn_old' } } })
      .set({ customer: { slug: 'old' } })
    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 1, turnId: 'turn_old' },
    }, { ...ctx, session: { id: 'sess_old' } })

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, ctx)
    useLogger(toolContext()).set({ customer: { slug: 'new' } })
    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 1, turnId: TURN_ID },
    }, ctx)

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 1, turnId: TURN_ID_1 },
    }, ctx)
    const log = useLogger(toolContext(TURN_ID_1))
    await hook.events!['turn.completed']!({
      type: 'turn.completed',
      data: { sequence: 2, turnId: TURN_ID_1 },
    }, ctx)

    await waitForDrainCalls(spies.drain, 3)
    const latestTurn = findEventViaDrain(spies.drain, e => e.path?.includes(TURN_ID_1))
    expect(latestTurn?.customer).toEqual({ slug: 'new' })
    expect(latestTurn?.customer).not.toEqual({ slug: 'old' })
  })

  it('does not reinitialize an existing logger on first turn', async () => {
    resetEvlogEveForTests()
    initLogger({ env: { service: 'existing-app' } })

    const initSpy = vi.spyOn(await import('../src/logger'), 'initLogger')
    const spies = createPipelineSpies()
    await runTurn(defineEvlogHook({ drain: spies.drain, init: { env: { service: 'eve-agent' } } }))

    expect(initSpy).not.toHaveBeenCalled()
    initSpy.mockRestore()
  })
})

describe('defineEvlogInstrumentation', () => {
  beforeEach(() => {
    resetEvlogEveForTests()
    initLogger({ env: { service: 'eve-test' } })
  })

  afterEach(() => {
    resetEvlogEveForTests()
  })

  function stepStartedInput(turnId = TURN_ID) {
    return {
      channel: { kind: 'http' },
      modelInput: { instructions: undefined, messages: [] },
      session: { id: SESSION_ID, auth: { current: null, initiator: null } },
      step: { index: 0 },
      turn: { id: turnId, sequence: 0 },
    } as Parameters<
      NonNullable<NonNullable<ReturnType<typeof defineEvlogInstrumentation>['events']>['step.started']>
    >[0]
  }

  it('links the model-call span to the wide event of the active turn', () => {
    const hook = defineEvlogHook({})
    const instrumentation = defineEvlogInstrumentation()

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, hookContext())

    expect(instrumentation.events!['step.started']!(stepStartedInput())).toEqual({
      runtimeContext: {
        'evlog.request_id': `${SESSION_ID}:${TURN_ID}`,
        'evlog.session_id': SESSION_ID,
      },
    })
  })

  it('contributes no context outside a tracked turn', () => {
    const instrumentation = defineEvlogInstrumentation()

    expect(instrumentation.events!['step.started']!(stepStartedInput())).toBeUndefined()
  })

  it('does not throw when no hook is registered', () => {
    const instrumentation = defineEvlogInstrumentation()

    expect(() => instrumentation.events!['step.started']!(stepStartedInput())).not.toThrow()
  })

  it('passes capture settings and setup through to eve', () => {
    const setup = vi.fn()
    const instrumentation = defineEvlogInstrumentation({
      functionId: 'support-agent',
      recordInputs: false,
      recordOutputs: false,
      traceChannelRequests: true,
      setup,
    })

    expect(instrumentation).toMatchObject({
      functionId: 'support-agent',
      recordInputs: false,
      recordOutputs: false,
      traceChannelRequests: true,
    })
    instrumentation.setup!({ agentName: 'support-agent' })
    expect(setup).toHaveBeenCalledWith({ agentName: 'support-agent' })
  })

  it('declares nothing beyond the event hook when unconfigured', () => {
    expect(Object.keys(defineEvlogInstrumentation())).toEqual(['events'])
  })
})

describe('evlogRuntimeContext', () => {
  beforeEach(() => {
    resetEvlogEveForTests()
    initLogger({ env: { service: 'eve-test' } })
  })

  afterEach(() => {
    resetEvlogEveForTests()
  })

  function stepStartedInput(turnId = TURN_ID) {
    return {
      channel: { kind: 'http' },
      modelInput: { instructions: undefined, messages: [] },
      session: { id: SESSION_ID, auth: { current: null, initiator: null } },
      step: { index: 0 },
      turn: { id: turnId, sequence: 0 },
    } as Parameters<typeof evlogRuntimeContext>[0]
  }

  it('returns attributes that spread into an authored runtime context', () => {
    const hook = defineEvlogHook({})

    hook.events!['turn.started']!({
      type: 'turn.started',
      data: { sequence: 0, turnId: TURN_ID },
    }, hookContext())

    expect({
      ...evlogRuntimeContext(stepStartedInput()),
      posthog_distinct_id: 'user_1',
    }).toEqual({
      'evlog.request_id': `${SESSION_ID}:${TURN_ID}`,
      'evlog.session_id': SESSION_ID,
      posthog_distinct_id: 'user_1',
    })
  })

  it('spreads to nothing outside a tracked turn', () => {
    expect(evlogRuntimeContext(stepStartedInput())).toBeUndefined()
    expect({ ...evlogRuntimeContext(stepStartedInput()) }).toEqual({})
  })
})
