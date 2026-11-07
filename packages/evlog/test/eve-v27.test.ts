import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import type { HookContext, HookDefinition, HookEventMap, HookEventType, StreamEventHook } from 'eve/hooks'
import type { InstrumentationModelStartedInput } from 'eve/instrumentation'
import { initLogger } from '../src/logger'
import type { WideEvent } from '../src/types'
import { defineEvlogHook, evlogRuntimeContext, resetEvlogEveForTests } from '../src/eve/index'
import { createPipelineSpies, findEventViaDrain, waitForDrainCalls } from './helpers/framework'
import { defined } from './helpers/defined'

const SESSION_ID = 'sess_v27'
const TURN_ID = 'turn_0'
const RUN_ID = 'run_0'

function hookContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    agent: { name: 'test-agent' },
    channel: { kind: 'http' },
    session: { id: SESSION_ID },
    ...overrides,
  } as HookContext
}

/** Calls the hook's handler for `type` the way eve does: the event, its turn in `scope`, and the hook context. */
async function fire<TKey extends HookEventType>(
  hook: HookDefinition,
  type: TKey,
  data: HookEventMap[TKey]['data'],
  options: { turnId?: string, ctx?: HookContext } = {},
): Promise<void> {
  const handler = defined(hook.events?.[type] as StreamEventHook<HookEventMap[TKey], TKey> | undefined, `handler for ${type}`)
  const turnId = options.turnId ?? TURN_ID
  const event = { type, data, scope: { turnId } } as HookEventMap[TKey]
  await handler(event, (options.ctx ?? hookContext()) as HookContext<TKey>)
}

/** One object field of a wide event (`eve`, `ai`), for assertions on its keys. */
function field(event: WideEvent | undefined, key: string): Record<string, unknown> | undefined {
  return event?.[key] as Record<string, unknown> | undefined
}

const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 0 }

async function startTurn(hook: HookDefinition, turnId = TURN_ID, ctx?: HookContext): Promise<void> {
  await fire(hook, 'turn.started', { turnId, cause: { deliveryId: 'dlv_0' }, follows: null }, { turnId, ctx })
}

async function modelRun(
  hook: HookDefinition,
  options: { runId?: string, modelId?: string, finishReason?: string, costUsd?: number, turnId?: string } = {},
): Promise<void> {
  const runId = options.runId ?? RUN_ID
  const turnId = options.turnId ?? TURN_ID
  await fire(hook, 'model.started', { runId, modelId: options.modelId ?? 'anthropic/claude-sonnet-4.5', attempt: 1 }, { turnId })
  await fire(hook, 'usage.recorded', {
    owner: { runId },
    kind: 'model',
    usage: { ...usage, ...(options.costUsd !== undefined ? { costUsd: options.costUsd } : {}) },
  }, { turnId })
  await fire(hook, 'model.settled', { runId, outcome: 'completed', finishReason: options.finishReason ?? 'stop' }, { turnId })
}

async function settleTurn(
  hook: HookDefinition,
  outcome: HookEventMap['turn.settled']['data']['outcome'] = 'completed',
  options: { turnId?: string, ctx?: HookContext, error?: { code: string, message: string } } = {},
): Promise<void> {
  const turnId = options.turnId ?? TURN_ID
  await fire(hook, 'turn.settled', {
    turnId,
    outcome,
    ...(options.error ? { error: options.error } : {}),
  }, { turnId, ctx: options.ctx })
}

describe('evlog/eve on v27 session events (eve 0.84 and later)', () => {
  beforeEach(() => {
    resetEvlogEveForTests()
    initLogger({ env: { service: 'eve-test' } })
  })

  afterEach(() => {
    resetEvlogEveForTests()
  })

  it('emits one wide event when the turn settles', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await modelRun(hook, { finishReason: 'tool-calls', runId: 'run_0' })
    await modelRun(hook, { runId: 'run_1' })
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    const event = findEventViaDrain(drain, e => e.path === `/sessions/${SESSION_ID}/turns/${TURN_ID}`)
    expect(event).toMatchObject({ method: 'EVE', status: 200, requestId: `${SESSION_ID}:${TURN_ID}` })
    expect(event?.eve).toMatchObject({ sessionId: SESSION_ID, turnId: TURN_ID })
    expect(event?.ai).toMatchObject({
      calls: 2,
      steps: 2,
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 20,
      totalTokens: 300,
      model: 'anthropic/claude-sonnet-4.5',
      provider: 'anthropic',
      finishReason: 'stop',
    })
  })

  it('records the cost eve reports on usage.recorded', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await modelRun(hook, { costUsd: 0.012 })
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    expect(findEventViaDrain(drain, () => true)?.ai).toMatchObject({ costUsd: 0.012 })
  })

  it('emits a failed turn as an error wide event with the failure', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await settleTurn(hook, 'failed', { error: { code: 'MODEL_ERROR', message: 'provider unavailable' } })

    await waitForDrainCalls(drain)
    const event = findEventViaDrain(drain, () => true)
    expect(event).toMatchObject({ level: 'error', status: 500 })
    expect(field(event, 'eve')?.failure).toEqual({ code: 'MODEL_ERROR', message: 'provider unavailable' })
  })

  it('emits a cancelled turn as a non-error wide event', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await settleTurn(hook, 'cancelled')

    await waitForDrainCalls(drain)
    const event = findEventViaDrain(drain, () => true)
    expect(event).toMatchObject({ level: 'info', status: 499 })
    expect(event?.eve).toMatchObject({ phase: 'cancelled', cancelled: true })
  })

  it('records failed model attempts on a turn that still completes', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await fire(hook, 'model.retried', { runId: RUN_ID, attempt: 1, error: { code: 'RATE_LIMITED', message: 'slow down' } })
    await modelRun(hook)
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    expect(findEventViaDrain(drain, () => true)?.eve).toMatchObject({
      failedSteps: 1,
      stepFailures: [{ code: 'RATE_LIMITED', message: 'slow down', stepIndex: 0 }],
    })
  })

  it('records each tool call with its outcome and duration', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await fire(hook, 'call.requested', { callId: 'call_1', owner: { runId: RUN_ID }, capability: { kind: 'tool', name: 'search' } })
    await fire(hook, 'call.requested', { callId: 'call_2', owner: { runId: RUN_ID }, capability: { kind: 'tool', name: 'fetch_page' } })
    await fire(hook, 'call.settled', { callId: 'call_1', outcome: 'completed' })
    await fire(hook, 'call.settled', { callId: 'call_2', outcome: 'failed', error: { code: 'TIMEOUT', message: 'page timed out' } })
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    const tools = field(findEventViaDrain(drain, () => true), 'ai')?.tools
    expect(tools).toEqual([
      { name: 'search', durationMs: expect.any(Number), success: true },
      { name: 'fetch_page', durationMs: expect.any(Number), success: false, error: 'page timed out' },
    ])
  })

  it('records an approval a person accepted', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await fire(hook, 'call.requested', { callId: 'call_1', owner: { runId: RUN_ID }, capability: { kind: 'tool', name: 'deploy' } })
    await fire(hook, 'interaction.opened', {
      interactionId: 'int_1',
      subject: { callId: 'call_1' },
      request: { kind: 'approval', prompt: 'Deploy to production?' },
    })
    await fire(hook, 'interaction.settled', { interactionId: 'int_1', outcome: 'accepted' })
    await fire(hook, 'call.settled', { callId: 'call_1', outcome: 'completed' })
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    const event = findEventViaDrain(drain, () => true)
    expect(event?.approval).toEqual({ status: 'approved', tool: 'deploy' })
    expect(field(event, 'eve')?.phase).toBeUndefined()
  })

  it('records an approval a person declined', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await fire(hook, 'call.requested', { callId: 'call_1', owner: { runId: RUN_ID }, capability: { kind: 'tool', name: 'deploy' } })
    await fire(hook, 'interaction.opened', {
      interactionId: 'int_1',
      subject: { callId: 'call_1' },
      request: { kind: 'approval', prompt: 'Deploy to production?' },
    })
    await fire(hook, 'interaction.settled', { interactionId: 'int_1', outcome: 'declined' })
    await fire(hook, 'call.settled', { callId: 'call_1', outcome: 'rejected' })
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    const event = findEventViaDrain(drain, () => true)
    expect(event?.approval).toEqual({ status: 'rejected', tool: 'deploy' })
    expect(field(event, 'ai')?.tools).toEqual([{ name: 'deploy', durationMs: expect.any(Number), success: false, error: 'rejected' }])
    expect(field(event, 'eve')?.phase).toBe('rejected')
  })

  it('marks a turn that ended while an approval was open', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await fire(hook, 'call.requested', { callId: 'call_1', owner: { runId: RUN_ID }, capability: { kind: 'tool', name: 'deploy' } })
    await fire(hook, 'interaction.opened', {
      interactionId: 'int_1',
      subject: { callId: 'call_1' },
      request: { kind: 'approval', prompt: 'Deploy to production?' },
    })
    await settleTurn(hook, 'failed', { error: { code: 'TIMEOUT', message: 'nobody answered' } })

    await waitForDrainCalls(drain)
    const event = findEventViaDrain(drain, () => true)
    expect(event?.approval).toEqual({ status: 'pending', tool: 'deploy' })
    expect(field(event, 'eve')?.phase).toBe('awaiting-approval')
  })

  it('records a connection sign-in and its outcome', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await fire(hook, 'interaction.opened', {
      interactionId: 'int_1',
      subject: { turnId: TURN_ID },
      request: { kind: 'sign-in', prompt: 'Sign in to Linear', signIn: { name: 'linear' } },
    })
    await fire(hook, 'interaction.settled', { interactionId: 'int_1', outcome: 'declined', reason: 'user said no' })
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    expect(field(findEventViaDrain(drain, () => true), 'eve')?.authorizations).toEqual([{ name: 'linear', outcome: 'declined', reason: 'user said no', durationMs: expect.any(Number) },])
  })

  it('marks a turn awaiting a sign-in that never settled', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await fire(hook, 'interaction.opened', {
      interactionId: 'int_1',
      subject: { turnId: TURN_ID },
      request: { kind: 'sign-in', prompt: 'Sign in to GitHub', signIn: { name: 'github' } },
    })
    await settleTurn(hook, 'cancelled')

    await waitForDrainCalls(drain)
    expect(findEventViaDrain(drain, () => true)?.eve).toMatchObject({
      authorizations: [{ name: 'github' }],
    })
  })

  it('records the user message from delivery.consumed in preview mode, attachments reduced to their type', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain, message: 'preview', messagePreviewLength: 10 })

    await startTurn(hook)
    await fire(hook, 'delivery.consumed', {
      deliveryId: 'dlv_0',
      turnId: TURN_ID,
      parts: [
        { kind: 'text', text: 'Summarize this invoice please' },
        { kind: 'file', mediaType: 'application/pdf', filename: 'invoice-jane-doe.pdf' },
      ],
    })
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    expect(findEventViaDrain(drain, () => true)?.message).toEqual({
      received: 'Summarize …',
      parts: [{ type: 'file', mediaType: 'application/pdf' }],
    })
  })

  it('omits the user message by default', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await fire(hook, 'delivery.consumed', { deliveryId: 'dlv_0', turnId: TURN_ID, parts: [{ kind: 'text', text: 'secret' }] })
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    expect(findEventViaDrain(drain, () => true)?.message).toBeUndefined()
  })

  it('records the reply, the reasoning size and the structured result from content.completed', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain, message: 'full' })

    await startTurn(hook)
    await fire(hook, 'content.completed', { partId: 'p_0', runId: RUN_ID, kind: 'reasoning', value: 'thinking it over', phase: 'narration' })
    await fire(hook, 'content.completed', { partId: 'p_1', runId: RUN_ID, kind: 'text', value: 'Let me look.', phase: 'narration' })
    await fire(hook, 'content.completed', { partId: 'p_2', runId: RUN_ID, kind: 'text', value: 'Here is the summary.', phase: 'reply' })
    await fire(hook, 'content.completed', { partId: 'p_3', runId: RUN_ID, kind: 'result', value: { score: 3 }, phase: 'reply' })
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    const event = findEventViaDrain(drain, () => true)
    expect(event?.message).toEqual({ responseChars: 20, response: 'Here is the summary.' })
    expect(event?.eve).toMatchObject({ reasoning: { blocks: 1, chars: 16 }, result: { score: 3 } })
  })

  it('records compaction and context clearing from context.started and context.settled', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await fire(hook, 'context.started', { changeId: 'chg_0', kind: 'compaction', turnId: TURN_ID, trigger: { inputTokens: 180000 } })
    await fire(hook, 'context.settled', { changeId: 'chg_0', kind: 'compaction', outcome: 'completed' })
    await fire(hook, 'context.started', { changeId: 'chg_1', kind: 'clear', turnId: TURN_ID })
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    expect(findEventViaDrain(drain, () => true)?.eve).toMatchObject({
      compaction: { count: 1, inputTokensAtTrigger: 180000 },
      contextCleared: true,
    })
  })

  it('records a subagent call with its child session', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await fire(hook, 'call.requested', { callId: 'call_1', owner: { runId: RUN_ID }, capability: { kind: 'agent', name: 'researcher' } })
    await fire(hook, 'child.opened', { sessionId: 'sess_child', owner: { callId: 'call_1' }, name: 'researcher', stream: 'stream_child' })
    await fire(hook, 'call.settled', { callId: 'call_1', outcome: 'completed', output: 'three sources found' })
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    expect(field(findEventViaDrain(drain, () => true), 'eve')?.subagents).toEqual([
      {
        callId: 'call_1',
        name: 'researcher',
        childSessionId: 'sess_child',
        status: 'completed',
        output: 'three sources found',
        durationMs: expect.any(Number),
      }
    ])
  })

  it('records the runtime identity from session.started', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await fire(hook, 'session.started', {
      runtime: { agentId: 'agt_1', eveVersion: '1.0.0-rc.6', build: { gitSha: 'abc123', gitBranch: 'main' } },
    })
    await startTurn(hook)
    await settleTurn(hook)

    await waitForDrainCalls(drain)
    expect(field(findEventViaDrain(drain, () => true), 'eve')?.runtime).toEqual({
      version: '1.0.0-rc.6',
      agentId: 'agt_1',
      gitSha: 'abc123',
      gitBranch: 'main',
    })
  })

  it('flushes the open turn as failed when the session ends with a failure', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain })

    await startTurn(hook)
    await fire(hook, 'session.ended', { outcome: 'failed', error: { code: 'WORKFLOW_FAILED', message: 'step crashed' } })

    await waitForDrainCalls(drain)
    const event = findEventViaDrain(drain, () => true)
    expect(event).toMatchObject({ level: 'error', status: 500 })
    expect(field(event, 'eve')?.failure).toEqual({ code: 'WORKFLOW_FAILED', message: 'step crashed' })
  })

  it('emits the session wide event when the session ends and sessionEvent is on', async () => {
    const { drain } = createPipelineSpies()
    const hook = defineEvlogHook({ drain, sessionEvent: true })

    await startTurn(hook)
    await modelRun(hook, { costUsd: 0.01 })
    await settleTurn(hook)
    await startTurn(hook, 'turn_1')
    await settleTurn(hook, 'cancelled', { turnId: 'turn_1' })
    await fire(hook, 'session.ended', { outcome: 'completed' })

    await waitForDrainCalls(drain, 3)
    const sessionEvent = findEventViaDrain(drain, e => e.path === `/sessions/${SESSION_ID}`)
    expect(sessionEvent?.eve).toMatchObject({ scope: 'session', turns: 2, cancelledTurns: 1 })
    expect(sessionEvent?.ai).toMatchObject({ calls: 1, inputTokens: 100, costUsd: 0.01 })
  })
})

describe('evlogRuntimeContext on eve 0.84 and later', () => {
  beforeEach(() => {
    resetEvlogEveForTests()
    initLogger({ env: { service: 'eve-test' } })
  })

  afterEach(() => {
    resetEvlogEveForTests()
  })

  function modelStartedInput(turn?: { id: string }): Parameters<typeof evlogRuntimeContext>[0] {
    return { session: { id: SESSION_ID }, ...(turn ? { turn } : {}) }
  }

  it('accepts the input of an otelIntegration runtimeContext resolver', () => {
    expectTypeOf<InstrumentationModelStartedInput>().toExtend<Parameters<typeof evlogRuntimeContext>[0]>()
  })

  it('links the model attempt to the wide event of its turn', async () => {
    const hook = defineEvlogHook({})
    await startTurn(hook)

    expect(evlogRuntimeContext(modelStartedInput({ id: TURN_ID }))).toEqual({
      'evlog.request_id': `${SESSION_ID}:${TURN_ID}`,
      'evlog.session_id': SESSION_ID,
    })
  })

  it('adds nothing for a model attempt outside a turn', () => {
    expect(evlogRuntimeContext(modelStartedInput())).toBeUndefined()
  })
})
