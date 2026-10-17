import type { WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { applyDeprecatedAlias, formatPublicEnvKeys, resolveAdapterConfig } from '../shared/config'
import { warnDeprecatedEnvVar } from '../shared/deprecate'
import type { HttpDrainRequest } from '../shared/drain'
import { defineHttpDrain, sendEncodedDrainRequest } from '../shared/drain'

export interface BetterStackConfig {
  /** Better Stack API key (replaces deprecated `sourceToken`). */
  apiKey: string
  /**
   * @deprecated Removed in evlog v3. Use `apiKey` instead.
   */
  sourceToken?: string
  /** Logtail ingestion endpoint. Default: https://in.logs.betterstack.com */
  endpoint?: string
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
  /** Number of retry attempts on transient failures. Default: 2 */
  retries?: number
}

const BETTER_STACK_FIELDS: ConfigField<BetterStackConfig>[] = [
  { key: 'apiKey', env: ['NUXT_BETTER_STACK_API_KEY', 'BETTER_STACK_API_KEY'] },
  // Deprecated env var names — resolved as a fallback for `apiKey` below.
  { key: 'sourceToken', env: ['NUXT_BETTER_STACK_SOURCE_TOKEN', 'BETTER_STACK_SOURCE_TOKEN'] },
  { key: 'endpoint', env: ['NUXT_BETTER_STACK_ENDPOINT', 'BETTER_STACK_ENDPOINT'] },
  { key: 'timeout' },
  { key: 'retries' },
]

function applyApiKeyAlias(config: BetterStackConfig): BetterStackConfig {
  return applyDeprecatedAlias(config, {
    adapter: 'better-stack',
    from: 'sourceToken',
    to: 'apiKey',
  })
}

/**
 * Transform an evlog wide event into a Better Stack event.
 * Maps `timestamp` to `dt` (Better Stack's expected field).
 */
export function toBetterStackEvent(event: WideEvent): Record<string, unknown> {
  const { timestamp, ...rest } = event
  return { ...rest, dt: timestamp }
}

/**
 * Create a drain function for sending logs to Better Stack.
 *
 * Configuration priority (highest to lowest):
 * 1. Overrides passed to createBetterStackDrain()
 * 2. runtimeConfig.evlog.betterStack
 * 3. runtimeConfig.betterStack
 * 4. Environment variables: BETTER_STACK_API_KEY (or legacy `BETTER_STACK_SOURCE_TOKEN`)
 *
 * @example
 * ```ts
 * initLogger({ drain: createBetterStackDrain() })
 *
 * initLogger({ drain: createBetterStackDrain({ apiKey: 'my-key' }) })
 * ```
 */
export function createBetterStackDrain(overrides?: Partial<BetterStackConfig>) {
  warnDeprecatedEnvVar('better-stack', ['NUXT_BETTER_STACK_SOURCE_TOKEN', 'BETTER_STACK_SOURCE_TOKEN'], 'BETTER_STACK_API_KEY')
  return defineHttpDrain<BetterStackConfig>({
    name: 'better-stack',
    resolve: async () => {
      const resolved = await resolveAdapterConfig<BetterStackConfig>('betterStack', BETTER_STACK_FIELDS, overrides)
      const config = applyApiKeyAlias(resolved as BetterStackConfig)
      if (!config.apiKey) {
        console.error(`[evlog/better-stack] Missing apiKey. Set ${formatPublicEnvKeys(['NUXT_BETTER_STACK_API_KEY', 'BETTER_STACK_API_KEY'])} env var or pass to createBetterStackDrain()`)
        return null
      }
      return config
    },
    label: 'Better Stack',
    encode: encodeBetterStackRequest,
  })
}

/**
 * Encode a batch of wide events into the Better Stack ingest request. Shared by
 * {@link createBetterStackDrain} and {@link sendBatchToBetterStack}.
 */
function encodeBetterStackRequest(events: WideEvent[], config: BetterStackConfig): HttpDrainRequest {
  return {
    url: (config.endpoint ?? 'https://in.logs.betterstack.com').replace(/\/+$/, ''),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey ?? config.sourceToken}`,
    },
    body: JSON.stringify(events.map(toBetterStackEvent)),
  }
}

/**
 * Send a single event to Better Stack.
 */
export async function sendToBetterStack(event: WideEvent, config: BetterStackConfig): Promise<void> {
  await sendBatchToBetterStack([event], config)
}

/**
 * Send a batch of events to Better Stack.
 */
export async function sendBatchToBetterStack(events: WideEvent[], config: BetterStackConfig): Promise<void> {
  if (!(config.apiKey ?? config.sourceToken)) throw new Error('[evlog/better-stack] Missing apiKey')
  await sendEncodedDrainRequest(encodeBetterStackRequest(events, config), {
    label: 'Better Stack',
    source: 'better-stack',
    timeout: config.timeout,
    retries: config.retries,
  })
}
