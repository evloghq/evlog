import { appendFileSync } from 'node:fs'
import { defineEvlog } from 'evlog'
import type { RequestLogger } from 'evlog'

type FinishRecord = { path: string; status?: number; emitted: boolean; error?: string; startedFor?: unknown }
const finished: FinishRecord[] = ((globalThis as { __evlogFinished?: FinishRecord[] }).__evlogFinished ??= [])

export default defineEvlog({
  service: 'from-config-file',
  environment: 'from-config-file',
  enrich: (ctx) => {
    ctx.event.enrichedBy = 'evlog.config.ts'
  },
  drain: (ctx) => {
    appendFileSync(process.env.EVLOG_CONFIG_FIXTURE_OUT!, `${JSON.stringify(ctx.event)}\n`)
  },
  plugins: [
    {
      name: 'request-hooks',
      extendLogger(logger) {
        (logger as RequestLogger & { markStarted: (path: string) => void }).markStarted = path => logger.set({ startedFor: path })
      },
      onRequestStart({ logger, request }) {
        (logger as RequestLogger & { markStarted: (path: string) => void }).markStarted(request.path)
      },
      onRequestFinish({ logger, request, status, event, error }) {
        finished.push({ path: request.path, status, emitted: event !== null, error: error?.message, startedFor: logger.getContext().startedFor })
      },
    }
  ],
})
