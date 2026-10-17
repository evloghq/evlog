import type { WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { applyDeprecatedAlias, formatPublicEnvKeys, resolveAdapterConfig } from '../shared/config'
import { warnDeprecatedEnvVar } from '../shared/deprecate'
import type { HttpDrainRequest } from '../shared/drain'
import { defineHttpDrain, sendEncodedDrainRequest } from '../shared/drain'

interface BaseAxiomConfig {
  /** Axiom dataset name. */
  dataset: string
  /**
   * Axiom API key.
   *
   * @example `xaat-...`
   */
  apiKey: string
  /**
   * @deprecated Removed in evlog v3. Use `apiKey` instead.
   */
  token?: string
  /** Organization ID (required for Personal Access Tokens). */
  orgId?: string
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
  /** Number of retry attempts on transient failures. Default: 2 */
  retries?: number
}

interface EdgeAxiomConfig {
  /**
   * Edge URL for Axiom ingest/query endpoints.
   * If no path is provided, uses /v1/ingest/{dataset}.
   * If a custom path is provided, it is used as-is (trailing slash trimmed).
   */
  edgeUrl: string
  /** Mutually exclusive with edgeUrl. */
  baseUrl?: never
}

interface EndpointAxiomConfig {
  /** Base URL for Axiom API. Uses /v1/datasets/{dataset}/ingest. */
  baseUrl?: string
  /** Mutually exclusive with baseUrl. */
  edgeUrl?: never
}

export type AxiomConfig = BaseAxiomConfig & (EdgeAxiomConfig | EndpointAxiomConfig)

type ResolvedAxiomConfig = BaseAxiomConfig & {
  edgeUrl?: string
  baseUrl?: string
}

const AXIOM_FIELDS: ConfigField<ResolvedAxiomConfig>[] = [
  { key: 'dataset', env: ['NUXT_AXIOM_DATASET', 'AXIOM_DATASET'] },
  { key: 'apiKey', env: ['NUXT_AXIOM_API_KEY', 'AXIOM_API_KEY'] },
  // Deprecated env var names — resolved as a fallback for `apiKey` below.
  { key: 'token', env: ['NUXT_AXIOM_TOKEN', 'AXIOM_TOKEN'] },
  { key: 'orgId', env: ['NUXT_AXIOM_ORG_ID', 'AXIOM_ORG_ID'] },
  { key: 'edgeUrl', env: ['NUXT_AXIOM_EDGE_URL', 'AXIOM_EDGE_URL'] },
  { key: 'baseUrl', env: ['NUXT_AXIOM_URL', 'AXIOM_URL'] },
  { key: 'timeout' },
  { key: 'retries' },
]

function applyApiKeyAlias(config: Partial<ResolvedAxiomConfig>): Partial<ResolvedAxiomConfig> {
  return applyDeprecatedAlias(config, {
    adapter: 'axiom',
    from: 'token',
    to: 'apiKey',
  })
}

/**
 * Create a drain function for sending logs to Axiom.
 *
 * Configuration priority (highest to lowest):
 * 1. Overrides passed to createAxiomDrain()
 * 2. runtimeConfig.evlog.axiom
 * 3. runtimeConfig.axiom
 * 4. Environment variables: AXIOM_API_KEY, AXIOM_DATASET (or legacy `AXIOM_TOKEN`)
 *
 * @example
 * ```ts
 * // Zero config — set AXIOM_API_KEY and AXIOM_DATASET
 * initLogger({ drain: createAxiomDrain() })
 *
 * // With overrides
 * initLogger({ drain: createAxiomDrain({ dataset: 'my-dataset' }) })
 * ```
 */
export function createAxiomDrain(overrides?: Partial<AxiomConfig>) {
  warnDeprecatedEnvVar('axiom', ['NUXT_AXIOM_TOKEN', 'AXIOM_TOKEN'], 'AXIOM_API_KEY')
  return defineHttpDrain<AxiomConfig>({
    name: 'axiom',
    resolve: async () => {
      const resolved = await resolveAdapterConfig<ResolvedAxiomConfig>(
        'axiom',
        AXIOM_FIELDS,
        overrides as Partial<ResolvedAxiomConfig>,
      )
      const config = applyApiKeyAlias(resolved)
      if (!config.dataset || !config.apiKey) {
        console.error(`[evlog/axiom] Missing dataset or apiKey. Set ${formatPublicEnvKeys(['NUXT_AXIOM_API_KEY', 'AXIOM_API_KEY'], ['NUXT_AXIOM_DATASET', 'AXIOM_DATASET'])} env vars or pass to createAxiomDrain()`)
        return null
      }
      if (config.edgeUrl && config.baseUrl) {
        console.warn('[evlog/axiom] Both edgeUrl and baseUrl are set. edgeUrl takes precedence for ingest.')
        delete config.baseUrl
      }
      return config as AxiomConfig
    },
    label: 'Axiom',
    encode: encodeAxiomRequest,
    onResponse: logIngestWarnings,
  })
}

/**
 * Encode a batch of wide events into the Axiom ingest request. Shared by
 * {@link createAxiomDrain} and {@link sendBatchToAxiom} so both paths build
 * the same URL, headers and body.
 */
function encodeAxiomRequest(events: WideEvent[], config: AxiomConfig): HttpDrainRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey ?? config.token}`,
  }
  if (config.orgId) headers['X-Axiom-Org-Id'] = config.orgId
  return { url: resolveIngestUrl(config), headers, body: JSON.stringify(events) }
}

/**
 * Send a single event to Axiom.
 */
export async function sendToAxiom(event: WideEvent, config: AxiomConfig): Promise<void> {
  await sendBatchToAxiom([event], config)
}

/**
 * Send a batch of events to Axiom.
 */
export async function sendBatchToAxiom(events: WideEvent[], config: AxiomConfig): Promise<void> {
  if (!(config.apiKey ?? config.token)) {
    throw new Error('[evlog/axiom] Missing apiKey')
  }
  await sendEncodedDrainRequest(encodeAxiomRequest(events, config), {
    label: 'Axiom',
    source: 'axiom',
    timeout: config.timeout,
    retries: config.retries,
    onResponse: logIngestWarnings,
  })
}

interface AxiomIngestResponse {
  failed?: number
  failures?: Array<{ error?: string }>
  messages?: Array<{ msg?: string }>
}

/**
 * Log Axiom's ingest warnings: partial failures and schema messages (e.g.
 * locked-schema field drops) that a 2xx response can still carry.
 */
async function logIngestWarnings(response: Response): Promise<void> {
  const text = await response.text().catch(() => '')
  if (!text) return
  let body: AxiomIngestResponse
  try {
    body = JSON.parse(text) as AxiomIngestResponse
  } catch {
    return
  }
  if (body.failed && body.failed > 0) {
    const details = body.failures?.map(failure => failure.error).filter(Boolean).join('; ')
    console.warn(`[evlog/axiom] ${body.failed} event(s) failed to ingest${details ? `: ${details}` : ''}`)
  }
  for (const message of body.messages ?? []) {
    if (message.msg) console.warn(`[evlog/axiom] ${message.msg}`)
  }
}

function resolveIngestUrl(config: AxiomConfig): string {
  const encodedDataset = encodeURIComponent(config.dataset)

  if (!config.edgeUrl) {
    const baseUrl = config.baseUrl ?? 'https://api.axiom.co'
    const url = new URL(`${baseUrl}/v1/datasets/${encodedDataset}/ingest`)
    url.searchParams.set('timestamp-field', 'timestamp')
    return url.toString()
  }

  try {
    const parsed = new URL(config.edgeUrl)
    if (parsed.pathname === '' || parsed.pathname === '/') {
      parsed.pathname = `/v1/ingest/${encodedDataset}`
    } else {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    }
    parsed.searchParams.set('timestamp-field', 'timestamp')
    return parsed.toString()
  } catch {
    console.warn(`[evlog/axiom] edgeUrl "${config.edgeUrl}" is not a valid URL, falling back to string concatenation.`)
    const trimmed = config.edgeUrl.replace(/\/+$/, '')
    return `${trimmed}/v1/ingest/${encodedDataset}?timestamp-field=timestamp`
  }
}
