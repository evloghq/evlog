import type { ModelMessage } from 'ai'
import type { SessionAuthContext } from 'eve/context'
import { defineAgent, defineDynamic } from 'eve'
import { gatewayRouting, sessionTags } from './lib/gateway'
import { MODEL } from './lib/model'
import { decideOncePerTurn, reasoningFor, selectReasoning, turnIdOf, type ReasoningDecision } from './lib/reasoning-routing'
import { isScheduleAppAuth } from './lib/trust'

interface ModelContext {
  channel: { kind?: string }
  session: { id: string, auth: { current: SessionAuthContext | null } }
}

interface StepContext extends ModelContext {
  messages: readonly ModelMessage[]
  abortSignal?: AbortSignal
}

/**
 * `EVI_MODEL` names a candidate under evaluation; a routed reasoning level
 * would put a second variable into every eval run, so the override also pins
 * the effort the agent was authored with.
 */
const REASONING_ROUTED = !process.env.EVI_MODEL

/**
 * Schedules deliver through the maintainer's channel, so `channel.kind` names
 * that channel and never `schedule`: the app principal on the turn is what
 * separates a scheduled run from a message the maintainer just sent.
 */
function modelOptions(ctx: ModelContext, reasoning?: ReasoningDecision) {
  return {
    providerOptions: {
      gateway: {
        ...gatewayRouting(isScheduleAppAuth(ctx.session.auth.current)),
        tags: sessionTags(ctx.channel.kind, reasoning),
      },
    },
  }
}

function selectModel(_event: unknown, ctx: ModelContext) {
  return { model: MODEL, modelOptions: modelOptions(ctx) }
}

/**
 * Same model every step; only the reasoning effort moves, chosen once per turn
 * by Jev from the recent messages. eve's `auto` cannot carry the gateway
 * options above (a dynamic model rejects sibling `modelOptions`), so the
 * selection is assembled here and the decision travels on the request as an
 * `evi:reasoning` tag. Anything the evaluator cannot decide runs at the
 * agent's authored effort, never as a failed turn.
 */
async function selectStepModel(event: unknown, ctx: StepContext) {
  const turnId = turnIdOf(event)
  if (!REASONING_ROUTED || !turnId) return selectModel(event, ctx)
  const decision = await decideOncePerTurn(
    `${ctx.session.id}:${turnId}`,
    () => selectReasoning({ messages: ctx.messages, abortSignal: ctx.abortSignal }),
  )
  return { model: MODEL, reasoning: reasoningFor(decision), modelOptions: modelOptions(ctx, decision) }
}

export default defineAgent({
  // Also on turn.started: a session whose process died before the selection
  // committed resumes with none, and eve fails the turn rather than guess.
  // step.started refines the turn's selection with a reasoning level; it
  // returns the same model, so the prompt cache carries across.
  model: defineDynamic({
    events: {
      'session.started': selectModel,
      'turn.started': selectModel,
      'step.started': selectStepModel,
    },
  }),
  reasoning: 'high',
  /** Bounds a runaway session, not cost: one real thread runs a few million in. */
  /**
   * A million-token window means eve's default (90%) never compacts here, so a
   * long turn re-sends its whole history on every step. Compacting past 100k
   * keeps the prefill bounded while a normal turn stays untouched.
   */
  compaction: { thresholdPercent: 0.1 },
  limits: {
    maxInputTokensPerSession: 40_000_000,
    maxOutputTokensPerSession: 250_000,
  },
})
