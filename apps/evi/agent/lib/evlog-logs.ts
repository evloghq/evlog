import type evlog from '@evlog/eve'
import { canAccessAdminTools } from './trust'

type LogsSettings = NonNullable<NonNullable<Parameters<typeof evlog>[0]>['logs']>

/**
 * What the evlog `logs` tool reads for Evi. On Vercel it reads runtime logs
 * through `vercel/evlog`, the connector the Vercel connection and
 * `set_vercel_env` already ride; @evlog/eve has no default connector.
 */
export const evlogLogs: LogsSettings = {
  // Every human in the Slack workspace DMs evi in a private conversation, so
  // audience cannot gate reading other callers' turns: only admins and schedules do.
  access: (ctx) => {
    const caller = ctx.session.auth.current ?? null
    if (canAccessAdminTools(caller)) return 'agent'
    return caller && caller.principalType !== 'anonymous' ? 'session' : false
  },
  vercel: { connector: 'vercel/evlog' },
}
