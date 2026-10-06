import type { SessionAuthContext } from 'eve/context'
import { defineAgent, defineDynamic } from 'eve'
import { gatewayRouting, sessionTags } from './lib/gateway'
import { reviewStepModel } from './lib/github/review-model'
import { MODEL } from './lib/model'
import { isScheduleAppAuth } from './lib/trust'

interface ModelContext {
  channel: { kind?: string }
  session: { auth: { current: SessionAuthContext | null } }
}

/**
 * Schedules deliver through the maintainer's channel, so `channel.kind` names
 * that channel and never `schedule`: the app principal on the turn is what
 * separates a scheduled run from a message the maintainer just sent.
 */
function modelOptions(ctx: ModelContext) {
  return {
    providerOptions: {
      gateway: {
        ...gatewayRouting(isScheduleAppAuth(ctx.session.auth.current)),
        tags: sessionTags(ctx.channel.kind),
      },
    },
  }
}

function selectModel(_event: unknown, ctx: ModelContext) {
  return { model: MODEL, modelOptions: modelOptions(ctx) }
}

export default defineAgent({
  // Also on turn.started: a session whose process died before the selection
  // committed resumes with none, and eve fails the turn rather than guess.
  model: defineDynamic({
    events: {
      'session.started': selectModel,
      'turn.started': selectModel,
      'step.started': (_event, ctx) => {
        const model = reviewStepModel(ctx.session.auth.current)
        return {
          model,
          modelContextWindowTokens: typeof model === 'string' ? undefined : 1_000_000,
          modelOptions: modelOptions(ctx),
        }
      },
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
