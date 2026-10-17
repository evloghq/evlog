import type { WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { formatPublicEnvKeys, resolveAdapterConfig } from '../shared/config'
import type { HttpDrainRequest } from '../shared/drain'
import { defineDrain, defineHttpDrain, sendEncodedDrainRequest } from '../shared/drain'
import { flattenRecord } from '../shared/event'
import { warnDeprecated } from '../shared/deprecate'
import { sendBatchToOTLP } from './otlp'
import type { OTLPConfig, OTLPRecordShape } from './otlp'

/**
 * Mode for {@link createPostHogDrain}.
 *
 * - `'logs'` (default) — sends events to PostHog Logs via OTLP. Cheapest path
 *   and recommended for most teams.
 * - `'events'` — sends events to the `/batch/` API as custom PostHog events.
 *   Useful when you want events to appear in PostHog product analytics
 *   funnels/dashboards.
 */
export type PostHogMode = 'logs' | 'events'

export interface PostHogConfig {
  /** PostHog project API key */
  apiKey: string
  /** PostHog host URL. Default: https://us.i.posthog.com */
  host?: string
  /**
   * Send mode. `'logs'` (default) uses PostHog Logs (OTLP, cheapest);
   * `'events'` uses the `/batch/` API for custom PostHog events.
   * @default 'logs'
   */
  mode?: PostHogMode
  /**
   * PostHog event name when `mode === 'events'`. Ignored otherwise.
   * @default 'evlog_wide_event'
   */
  eventName?: string
  /**
   * Static PostHog person identifier, used for every event. Overrides
   * {@link PostHogConfig.distinctIdField}.
   */
  distinctId?: string
  /**
   * Wide-event field holding the PostHog person identifier, as a dot path
   * (`userId`, `user.id`, `actor.id`). Default: `userId`.
   *
   * In `'logs'` mode it is sent as the `posthogDistinctId` log attribute — the
   * attribute PostHog matches against a person's `distinct_id` to surface the
   * log on their profile. In `'events'` mode it becomes `distinct_id`.
   */
  distinctIdField?: string
  /**
   * Wide-event field holding the PostHog session id, as a dot path. Default:
   * `sessionId`.
   *
   * Sent as the `sessionId` log attribute in `'logs'` mode, which is what links
   * a backend log to the user's session replay. Pass the id from the frontend
   * (`posthog.get_session_id()`) and record it on the event.
   */
  sessionIdField?: string
  /**
   * Record shape. Default: `'json'`.
   *
   * In `'events'` mode, `'compact'` flattens nested properties into dotted
   * keys (`ai.costUsd`), which is what the PostHog UI filters and breaks down
   * by — a nested object is one opaque property there.
   *
   * @see {@link OTLPRecordShape}
   */
  recordShape?: OTLPRecordShape
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
  /** Number of retry attempts on transient failures. Default: 2 */
  retries?: number
}

/**
 * @deprecated Removed in evlog v3. Use {@link PostHogConfig} with `mode: 'events'` instead.
 */
export type PostHogEventsConfig = PostHogConfig

/** PostHog event structure for the batch API */
export interface PostHogEvent {
  event: string
  distinct_id: string
  timestamp: string
  properties: Record<string, unknown>
}

const POSTHOG_FIELDS: ConfigField<PostHogConfig>[] = [
  { key: 'apiKey', env: ['NUXT_POSTHOG_API_KEY', 'POSTHOG_API_KEY'] },
  { key: 'host', env: ['NUXT_POSTHOG_HOST', 'POSTHOG_HOST'] },
  { key: 'mode' },
  { key: 'eventName' },
  { key: 'distinctId' },
  { key: 'distinctIdField' },
  { key: 'sessionIdField' },
  { key: 'recordShape' },
  { key: 'timeout' },
  { key: 'retries' },
]

function resolveHost(config: PostHogConfig): string {
  return (config.host ?? 'https://us.i.posthog.com').replace(/\/$/, '')
}

function toOTLPConfig(config: PostHogConfig): OTLPConfig {
  return {
    endpoint: `${resolveHost(config)}/i`,
    ...(config.recordShape ? { recordShape: config.recordShape } : {}),
    headers: { Authorization: `Bearer ${config.apiKey}` },
    timeout: config.timeout,
    retries: config.retries,
  }
}

const DEFAULT_DISTINCT_ID_FIELD = 'userId'
const DEFAULT_SESSION_ID_FIELD = 'sessionId'

/** Read a dot path off a wide event, keeping only scalar identifiers. */
function readIdentifier(event: WideEvent, path: string): string | undefined {
  let current: unknown = event
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  if (typeof current === 'string') return current.length > 0 ? current : undefined
  if (typeof current === 'number') return String(current)
  return undefined
}

function resolveDistinctId(event: WideEvent, config: PostHogConfig): string | undefined {
  if (config.distinctId) return config.distinctId
  return readIdentifier(event, config.distinctIdField ?? DEFAULT_DISTINCT_ID_FIELD)
}

function resolveSessionId(event: WideEvent, config: PostHogConfig): string | undefined {
  return readIdentifier(event, config.sessionIdField ?? DEFAULT_SESSION_ID_FIELD)
}

/**
 * Add the attributes PostHog reads to link a log record to a person and to a
 * session replay. Both are plain event fields so the OTLP encoder emits them
 * as log attributes, where PostHog looks for them.
 */
function withPostHogIdentity(event: WideEvent, config: PostHogConfig): WideEvent {
  const distinctId = resolveDistinctId(event, config)
  const sessionId = resolveSessionId(event, config)
  if (distinctId === undefined && sessionId === undefined) return event
  return {
    ...event,
    ...(distinctId !== undefined ? { posthogDistinctId: distinctId } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  }
}

/**
 * Convert a WideEvent to a PostHog custom event.
 *
 * Events without a resolvable person identifier are sent as anonymous ones —
 * `$process_person_profile: false` — rather than merged onto a person named
 * after the service. PostHog bills those at a lower rate and keeps them out of
 * person profiles.
 */
export function toPostHogEvent(event: WideEvent, config: PostHogConfig): PostHogEvent {
  const { timestamp, level, service, ...rest } = event
  const distinctId = resolveDistinctId(event, config)
  const fields = config.recordShape === 'compact' ? flattenRecord(rest) : rest
  return {
    event: config.eventName ?? 'evlog_wide_event',
    distinct_id: distinctId ?? service,
    timestamp,
    properties: {
      level,
      service,
      ...fields,
      ...(distinctId === undefined ? { $process_person_profile: false } : {}),
    },
  }
}

/**
 * Create a drain function for sending logs to PostHog.
 *
 * - Default `mode: 'logs'` — sends events to PostHog Logs via OTLP. Recommended.
 * - `mode: 'events'` — sends events to the `/batch/` API as custom events.
 *
 * Configuration priority (highest to lowest):
 * 1. Overrides passed to createPostHogDrain()
 * 2. runtimeConfig.evlog.posthog
 * 3. runtimeConfig.posthog
 * 4. Environment variables: POSTHOG_*
 *
 * Events carrying `userId` are surfaced on that person's profile in PostHog,
 * and those carrying `sessionId` link to their session replay. Point
 * {@link PostHogConfig.distinctIdField} elsewhere when your identity lives
 * under another field.
 *
 * @example
 * ```ts
 * // Default: PostHog Logs (OTLP)
 * initLogger({ drain: createPostHogDrain() })
 *
 * // Identity under `user.id` rather than `userId`
 * initLogger({ drain: createPostHogDrain({ distinctIdField: 'user.id' }) })
 *
 * // Custom events
 * initLogger({ drain: createPostHogDrain({ mode: 'events', eventName: 'server_request' }) })
 * ```
 */
export function createPostHogDrain(overrides?: Partial<PostHogConfig>) {
  const mode: PostHogMode = overrides?.mode ?? 'logs'

  if (mode === 'events') {
    return defineHttpDrain<PostHogConfig>({
      name: 'posthog-events',
      resolve: async () => {
        const config = await resolveAdapterConfig<PostHogConfig>('posthog', POSTHOG_FIELDS, overrides)
        if (!config.apiKey) {
          console.error(`[evlog/posthog-events] Missing apiKey. Set ${formatPublicEnvKeys(['NUXT_POSTHOG_API_KEY', 'POSTHOG_API_KEY'])} env var or pass to createPostHogDrain({ mode: 'events' })`)
          return null
        }
        return config as PostHogConfig
      },
      label: 'PostHog',
      encode: encodePostHogEventsRequest,
    })
  }

  return defineDrain<PostHogConfig>({
    name: 'posthog',
    resolve: async () => {
      const config = await resolveAdapterConfig<PostHogConfig>('posthog', POSTHOG_FIELDS, overrides)
      if (!config.apiKey) {
        console.error(`[evlog/posthog] Missing apiKey. Set ${formatPublicEnvKeys(['NUXT_POSTHOG_API_KEY', 'POSTHOG_API_KEY'])} env var or pass to createPostHogDrain()`)
        return null
      }
      return config as PostHogConfig
    },
    send: async (events, config) => {
      await sendBatchToPostHog(events, config)
    },
  })
}

/**
 * @deprecated Removed in evlog v3. Use {@link createPostHogDrain} with `mode: 'events'`.
 */
export function createPostHogEventsDrain(overrides?: Partial<PostHogConfig>) {
  warnDeprecated(
    'posthog:createPostHogEventsDrain',
    '[evlog/posthog] createPostHogEventsDrain() is deprecated and removed in v3. Use createPostHogDrain({ mode: \'events\' }).',
  )
  return createPostHogDrain({ ...overrides, mode: 'events' })
}

/**
 * Send a single event to PostHog Logs via OTLP.
 */
export async function sendToPostHog(event: WideEvent, config: PostHogConfig): Promise<void> {
  await sendBatchToPostHog([event], config)
}

/**
 * Send a batch of events to PostHog Logs via OTLP.
 */
export async function sendBatchToPostHog(events: WideEvent[], config: PostHogConfig): Promise<void> {
  if (events.length === 0) return
  await sendBatchToOTLP(
    events.map(event => withPostHogIdentity(event, config)),
    toOTLPConfig(config),
  )
}

/**
 * Send a single event to PostHog via the custom-events `/batch/` API.
 */
export async function sendToPostHogEvents(event: WideEvent, config: PostHogConfig): Promise<void> {
  await sendBatchToPostHogEvents([event], config)
}

/**
 * Send a batch of events to PostHog via the custom-events `/batch/` API.
 */
export async function sendBatchToPostHogEvents(events: WideEvent[], config: PostHogConfig): Promise<void> {
  if (events.length === 0) return
  await sendEncodedDrainRequest(encodePostHogEventsRequest(events, config), {
    label: 'PostHog',
    source: 'posthog',
    timeout: config.timeout,
    retries: config.retries,
  })
}

/**
 * Encode a batch of wide events into the PostHog custom-events `/batch/`
 * request. Shared by {@link createPostHogDrain} in `events` mode and
 * {@link sendBatchToPostHogEvents}.
 */
function encodePostHogEventsRequest(events: WideEvent[], config: PostHogConfig): HttpDrainRequest {
  return {
    url: `${resolveHost(config)}/batch/`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.apiKey,
      batch: events.map(event => toPostHogEvent(event, config)),
    }),
  }
}
