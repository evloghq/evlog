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
 * Never reads repository content.
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
    run(command, fn, opts) {
      return base.run(command, fn, {
        ...opts,
        systemCustom: {
          ghaAction: action,
          ghaEvent: eventType,
        },
      })
    },
  }
}
