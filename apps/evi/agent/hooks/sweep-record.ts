import { call } from 'eve/events'
import { defineHook } from 'eve/hooks'
import { SWEEP_TOOL_NAME, sweepRecord, writeSweepRecord } from '../lib/simplification/record'
import type { SimplificationSweepResult } from '../lib/simplification/workflow'

export default defineHook({
  events: {
    async 'call.settled'(event, ctx) {
      if (event.data.outcome !== 'completed' || call(ctx.view, event.data.callId)?.name !== SWEEP_TOOL_NAME) return
      // toolResultFrom's types exclude workflow tools; the output is the workflow's return value.
      const output = event.data.output as unknown as SimplificationSweepResult
      await writeSweepRecord(await ctx.getSandbox(), sweepRecord(output, new Date().toISOString(), event.data.callId))
    },
  },
})
