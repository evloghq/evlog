import type { WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { formatPublicEnvKeys, resolveAdapterConfig } from '../shared/config'
import { defineDrain } from '../shared/drain'
import type { OTLPConfig, OTLPRecordShape } from './otlp'
import { sendBatchToOTLP } from './otlp'

export interface SazabiConfig {
  /**
   * Intake URL of a Sazabi log stream, e.g. `https://<key>.us-west-2.intake.sazabi.com`.
   * The stream's public key is part of the URL, so no auth header is sent. evlog appends
   * `/v1/logs`; a URL that already ends with `/v1/logs` is accepted as is.
   * @see https://docs.sazabi.com
   */
  endpoint: string
  /** Passed through to the OTLP encoder; maps to `service.name`. */
  serviceName?: string
  /** Additional OTLP resource attributes. */
  resourceAttributes?: Record<string, string | number | boolean>
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
  /** Number of retry attempts on transient failures. Default: 2 */
  retries?: number
  /**
   * Log record shape. Default: `'compact'`: the body is a one-line summary (`POST /api/checkout (500)`) and
   * nested fields flatten to dotted attributes (`user.plan`) that can be filtered on in Sazabi.
   * `'json'` sends the serialized event as the body. To keep the 2.x output, set `'json'` and `semanticConventions: false`.
   * @see {@link OTLPRecordShape}
   */
  recordShape?: OTLPRecordShape
  /**
   * Also emit OpenTelemetry semantic convention attributes (`http.request.method`,
   * `url.path`, `http.response.status_code`, `exception.*`, `gen_ai.*`) and the
   * `deployment.environment.name` resource attribute, next to the evlog field names.
   * Default: `true`. Set `false` to send the evlog field names only. Together with
   * `recordShape: 'json'`, this keeps the 2.x output.
   */
  semanticConventions?: boolean
}

const ENDPOINT_ENV = ['NUXT_SAZABI_INTAKE_URL', 'SAZABI_INTAKE_URL']

const SAZABI_FIELDS: ConfigField<SazabiConfig>[] = [
  { key: 'endpoint', env: ENDPOINT_ENV },
  { key: 'serviceName', env: ['NUXT_SAZABI_SERVICE_NAME', 'SAZABI_SERVICE_NAME', 'OTEL_SERVICE_NAME'] },
  { key: 'resourceAttributes' },
  { key: 'timeout' },
  { key: 'retries' },
  { key: 'recordShape' },
  { key: 'semanticConventions' },
]

/**
 * Normalize a Sazabi intake URL to the OTLP HTTP base URL evlog appends `/v1/logs` to:
 * trailing slashes and a pasted `/v1/logs` suffix are removed.
 */
export function toSazabiOTLPEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '').replace(/\/v1\/logs$/, '')
}

/**
 * Map Sazabi config to {@link OTLPConfig}. Sazabi ingests OTLP/HTTP logs at
 * `<intake URL>/v1/logs`; the key lives in the URL, so no headers are added.
 */
export function toSazabiOTLPConfig(config: SazabiConfig): OTLPConfig {
  return {
    endpoint: toSazabiOTLPEndpoint(config.endpoint),
    serviceName: config.serviceName,
    resourceAttributes: config.resourceAttributes,
    timeout: config.timeout,
    retries: config.retries,
    recordShape: config.recordShape,
    semanticConventions: config.semanticConventions,
  }
}

/**
 * Create a drain that sends wide events to Sazabi via OTLP/HTTP.
 *
 * Configuration priority (highest to lowest):
 * 1. Overrides passed to `createSazabiDrain()`
 * 2. `runtimeConfig.evlog.sazabi`
 * 3. `runtimeConfig.sazabi`
 * 4. Environment variables: `SAZABI_INTAKE_URL`, `SAZABI_SERVICE_NAME` (and `OTEL_SERVICE_NAME`)
 *
 * @example
 * ```ts
 * nitroApp.hooks.hook('evlog:drain', createSazabiDrain())
 * // SAZABI_INTAKE_URL in env
 * ```
 */
export function createSazabiDrain(overrides?: Partial<SazabiConfig>) {
  return defineDrain<SazabiConfig>({
    name: 'sazabi',
    resolve: async () => {
      const config = await resolveAdapterConfig<SazabiConfig>('sazabi', SAZABI_FIELDS, overrides)
      if (!config.endpoint || !toSazabiOTLPEndpoint(config.endpoint)) {
        console.error(`[evlog/sazabi] Missing endpoint. Set ${formatPublicEnvKeys(ENDPOINT_ENV)}, or pass to createSazabiDrain()`)
        return null
      }
      return config as SazabiConfig
    },
    send: (events, config) => sendBatchToOTLP(events, toSazabiOTLPConfig(config)),
  })
}

/**
 * Send a single wide event to Sazabi (OTLP/HTTP).
 */
export async function sendToSazabi(event: WideEvent, config: SazabiConfig): Promise<void> {
  await sendBatchToSazabi([event], config)
}

/**
 * Send a batch of wide events to Sazabi (OTLP/HTTP).
 */
export async function sendBatchToSazabi(events: WideEvent[], config: SazabiConfig): Promise<void> {
  await sendBatchToOTLP(events, toSazabiOTLPConfig(config))
}
