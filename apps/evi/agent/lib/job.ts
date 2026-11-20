import type { AuditableLogger } from 'evlog'
import { createLogger } from 'evlog'

/**
 * Logger for work that runs outside a turn (channel failure handlers, cron
 * handoffs), where `useLogger()` has nothing to bind to. `job` names the work
 * so these events chart apart from turns; the global drain in
 * `agent/extensions/evlog.ts` delivers them.
 */
export function jobLogger(job: string, context: Record<string, unknown> = {}): AuditableLogger {
  return createLogger({ job, ...context })
}
