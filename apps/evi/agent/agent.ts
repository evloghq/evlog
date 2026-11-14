import { defineAgent, defineDynamic } from 'eve'
import { gatewayRouting, sessionTags } from './lib/gateway'
import { MODEL } from './lib/model'
import { isScheduleAppAuth } from './lib/trust'

export default defineAgent({
  /**
   * Schedules deliver through the maintainer's channel, so `channel.kind` names
   * that channel and never `schedule`: the app principal on the turn is what
   * separates a scheduled run from a message the maintainer just sent.
   */
  model: defineDynamic(ctx => ({
    model: MODEL,
    modelOptions: {
      providerOptions: {
        gateway: {
          ...gatewayRouting(isScheduleAppAuth(ctx.session.auth.current)),
          tags: sessionTags(ctx.channel.kind, 'evi'),
        },
      },
    },
  })),
  reasoning: 'high',
  /**
   * A million-token window means eve's default (90%) never compacts here, so a
   * long turn re-sends its whole history on every step. Compacting past 100k
   * keeps the prefill bounded while a normal turn stays untouched.
   */
  compaction: { threshold: 0.1 },
  /**
   * Bounds a runaway session, not cost: one real thread runs a few million in.
   * Output includes reasoning, and a run that fans out to reviewers spends ~500k.
   */
  limits: {
    sessionUsage: ({ window }) => window.inputTokens >= 40_000_000 || window.outputTokens >= 1_000_000,
  },
})
