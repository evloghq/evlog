import type { DrainContext } from 'evlog'
import { defineEvlog } from 'evlog'
import { createFsDrain } from 'evlog/fs'
import { createDrainPipeline } from 'evlog/pipeline'

/**
 * Settings for the support agent, read by `agent/hooks/evlog.ts` and by the
 * evlog CLI.
 *
 * @see https://evlog.dev/cli/config
 */
export default defineEvlog({
  service: 'clearbill-support-agent',
  drain: createDrainPipeline<DrainContext>({
    batch: { size: 5, intervalMs: 2000 },
  })(createFsDrain()),
  enrich: (ctx) => {
    ctx.event.runtime = process.env.VERCEL_REGION ?? 'local'
    ctx.event.demo = 'evlog-eve-support-refund'
  },
})
