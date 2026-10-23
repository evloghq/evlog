import type { WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { formatPublicEnvKeys, resolveAdapterConfig } from '../shared/config'
import { defineDrain } from '../shared/drain'
import type { OTLPConfig, OTLPRecordShape } from './otlp'
import { sendBatchToOTLP } from './otlp'

/**
 * HyperDX cloud OTLP HTTP base URL.
 * @see https://hyperdx.io/docs/install/opentelemetry — “Our OpenTelemetry HTTP endpoint is hosted at `https://in-otel.hyperdx.io` …”
 */
export const HYPERDX_DEFAULT_OTLP_HTTP_ENDPOINT = 'https://in-otel.hyperdx.io'

export interface HyperDXConfig {
  /**
   * Ingestion API key. Sent as the `authorization` header value, matching HyperDX’s OpenTelemetry docs:
   * `authorization: <YOUR_HYPERDX_API_KEY_HERE>`
   * @see https://hyperdx.io/docs/install/opentelemetry
   */
  apiKey: string
  /**
   * OTLP HTTP base URL (evlog appends `/v1/logs`). Defaults to {@link HYPERDX_DEFAULT_OTLP_HTTP_ENDPOINT}.
   * Self-hosted: set to your OTLP HTTP endpoint (same shape as `otlphttp` `endpoint` in HyperDX’s collector example).
   */
  endpoint?: string
  /** Passed through to the OTLP encoder; maps to `service.name`. */
  serviceName?: string
  /** Additional OTLP resource attributes. */
  resourceAttributes?: Record<string, string | number | boolean>
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
  /** Number of retry attempts on transient failures. Default: 2 */
  retries?: number
  /**
   * Log record shape. Default: `'compact'`: the body is a one-line summary and nested fields flatten to dotted attributes.
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

const HYPERDX_FIELDS: ConfigField<HyperDXConfig>[] = [
  { key: 'apiKey', env: ['NUXT_HYPERDX_API_KEY', 'HYPERDX_API_KEY'] },
  { key: 'endpoint', env: ['NUXT_HYPERDX_OTLP_ENDPOINT', 'HYPERDX_OTLP_ENDPOINT'] },
  { key: 'serviceName', env: ['NUXT_HYPERDX_SERVICE_NAME', 'HYPERDX_SERVICE_NAME', 'NUXT_OTLP_SERVICE_NAME', 'OTEL_SERVICE_NAME'] },
  { key: 'resourceAttributes' },
  { key: 'timeout' },
  { key: 'retries' },
  { key: 'recordShape' },
  { key: 'semanticConventions' },
]

/**
 * Map HyperDX config to {@link OTLPConfig}: same wire format as HyperDX’s documented `otlphttp` exporter
 * (`endpoint` + `authorization` header).
 */
export function toHyperDXOTLPConfig(config: HyperDXConfig): OTLPConfig {
  return {
    endpoint: config.endpoint ?? HYPERDX_DEFAULT_OTLP_HTTP_ENDPOINT,
    headers: {
      // HyperDX docs (OpenTelemetry): headers.authorization = API key
      authorization: config.apiKey,
    },
    serviceName: config.serviceName,
    resourceAttributes: config.resourceAttributes,
    timeout: config.timeout,
    retries: config.retries,
    recordShape: config.recordShape,
    semanticConventions: config.semanticConventions,
  }
}

/**
 * Create a drain that sends wide events to HyperDX via OTLP/HTTP.
 *
 * Matches [HyperDX OpenTelemetry ingest](https://hyperdx.io/docs/install/opentelemetry):
 * HTTP base URL defaults to `https://in-otel.hyperdx.io`; requests use the `authorization` header set to your API key.
 *
 * Configuration priority (highest to lowest):
 * 1. Overrides passed to `createHyperDXDrain()`
 * 2. `runtimeConfig.evlog.hyperdx`
 * 3. `runtimeConfig.hyperdx`
 * 4. Environment variables: `HYPERDX_*` (and `OTEL_SERVICE_NAME` for service name)
 *
 * @example
 * ```ts
 * nitroApp.hooks.hook('evlog:drain', createHyperDXDrain())
 * // HYPERDX_API_KEY in env
 * ```
 */
export function createHyperDXDrain(overrides?: Partial<HyperDXConfig>) {
  return defineDrain<HyperDXConfig>({
    name: 'hyperdx',
    resolve: async () => {
      const config = await resolveAdapterConfig<HyperDXConfig>('hyperdx', HYPERDX_FIELDS, overrides)
      if (!config.apiKey) {
        console.error(`[evlog/hyperdx] Missing apiKey. Set ${formatPublicEnvKeys(['NUXT_HYPERDX_API_KEY', 'HYPERDX_API_KEY'])}, or pass to createHyperDXDrain()`)
        return null
      }
      return config as HyperDXConfig
    },
    send: (events, config) => sendBatchToOTLP(events, toHyperDXOTLPConfig(config)),
  })
}

/**
 * Send a single wide event to HyperDX (OTLP/HTTP).
 */
export async function sendToHyperDX(event: WideEvent, config: HyperDXConfig): Promise<void> {
  await sendBatchToHyperDX([event], config)
}

/**
 * Send a batch of wide events to HyperDX (OTLP/HTTP).
 */
export async function sendBatchToHyperDX(events: WideEvent[], config: HyperDXConfig): Promise<void> {
  await sendBatchToOTLP(events, toHyperDXOTLPConfig(config))
}
