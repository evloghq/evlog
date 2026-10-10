import { appendFileSync } from 'node:fs'
import { defineEvlog } from 'evlog'

export default defineEvlog({
  service: 'from-config-file',
  environment: 'from-config-file',
  enrich: (ctx) => {
    ctx.event.enrichedBy = 'evlog.config.ts'
  },
  drain: (ctx) => {
    appendFileSync(process.env.EVLOG_CONFIG_FIXTURE_OUT!, `${JSON.stringify(ctx.event)}\n`)
  },
})
