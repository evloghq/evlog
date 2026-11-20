import evlog from '@evlog/eve'
import { createFsDrain } from 'evlog/fs'
import { createPostHogDrain } from 'evlog/posthog'
import { createFanOutDrain } from '../lib/drains'
import { environment } from '../lib/environment'
import { canAccessAdminTools } from '../lib/trust'

const batch = { batch: { size: 5, intervalMs: 2000 } }

/** The fs drain needs a writable filesystem, which Vercel only offers under /tmp. */
const fs = process.env.VERCEL ? [] : [createFsDrain()]

// Events, not Logs: at a few dozen turns a day the per-GB saving is
// irrelevant and only events can be charted and alerted on.
function posthog(eventName: string) {
  if (!process.env.POSTHOG_API_KEY) return []
  return [
    createPostHogDrain({
      mode: 'events',
      eventName,
      distinctIdField: 'eve.caller.principalId',
      recordShape: 'compact',
    })
  ]
}

const turnDrain = createFanOutDrain([...fs, ...posthog('evi_turn')], batch)

/** Out-of-turn work (`agent/lib/job.ts`) emits through the global logger, so it gets its own event name. */
const jobDrain = createFanOutDrain([...fs, ...posthog('evi_job')], batch)

export default evlog({
  init: {
    env: { service: 'evi', environment: environment() },
    ...(jobDrain ? { drain: jobDrain } : {}),
  },
  ...(turnDrain ? { drain: turnDrain } : {}),
  // Every human in the Slack workspace DMs evi in a private conversation, so
  // audience cannot gate reading other callers' turns: only admins and schedules do.
  logs: {
    access: (ctx) => {
      const caller = ctx.session.auth.current ?? null
      if (canAccessAdminTools(caller)) return 'agent'
      return caller && caller.principalType !== 'anonymous' ? 'session' : false
    },
  },
})
