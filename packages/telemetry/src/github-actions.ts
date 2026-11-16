import type { CollectFields, CollectFlags, TelemetryHandle, TelemetryOptions } from './types'
import { createTelemetry } from './create'

export interface GitHubActionsTelemetryOptions<
  TFlags extends CollectFlags = {},
  TFields extends CollectFields = {},
> extends TelemetryOptions<TFlags, TFields> {
  /** Override detected action name. Defaults to `GITHUB_ACTION`. */
  actionName?: string
  /** Override detected event type. Defaults to `GITHUB_EVENT_NAME`. */
  eventType?: string
}

/**
 * Thin helper for GitHub Actions — enriches with action metadata from env only.
 * Never reads repository content. Each `run()` flushes the outbox before returning.
 */
export function createGitHubActionsTelemetry<
  TFlags extends CollectFlags = {},
  TFields extends CollectFields = {},
>(
  options: GitHubActionsTelemetryOptions<TFlags, TFields>,
): TelemetryHandle<TFlags, TFields> {
  const base = createTelemetry(options)
  const action = options.actionName ?? process.env.GITHUB_ACTION ?? 'unknown'
  const eventType = options.eventType ?? process.env.GITHUB_EVENT_NAME ?? 'unknown'

  return {
    get enabled() {
      return base.enabled
    },
    set(fields) {
      base.set(fields)
    },
    flush() {
      return base.flush()
    },
    // Runners discard the outbox when the job ends, so the coalescing window would never elapse.
    async run(command, fn, opts) {
      try {
        return await base.run(command, fn, {
          ...opts,
          systemCustom: {
            ghaAction: action,
            ghaEvent: eventType,
          },
        })
      } finally {
        await base.flush()
      }
    },
  }
}
