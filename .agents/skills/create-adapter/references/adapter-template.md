# Adapter Source Template

Complete TypeScript template for `packages/evlog/src/adapters/{name}.ts` using the public toolkit primitives `defineHttpDrain` + `resolveAdapterConfig`. Modeled on the most recent adapters (`loki.ts`, `clickhouse.ts`).

Replace `{Name}`, `{name}`, and `{NAME}` with the actual service name.

```typescript
import type { WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { formatPublicEnvKeys, resolveAdapterConfig } from '../shared/config'
import type { HttpDrainRequest } from '../shared/drain'
import { defineHttpDrain, sendEncodedDrainRequest } from '../shared/drain'

// --- 1. Config Interface -------------------------------------------------
// Service-specific fields. Standard names: apiKey, endpoint, serviceName,
// timeout, retries.

export interface {Name}Config {
  /** {Name} API key */
  apiKey: string
  /** {Name} API endpoint. Default: https://api.{name}.com */
  endpoint?: string
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
  /** Number of retry attempts on transient failures. Default: 2 */
  retries?: number
  // Add service-specific fields here (dataset, project, region, etc.)
}

// Field manifest — drives resolveAdapterConfig (overrides → runtimeConfig.evlog.{name}
// → runtimeConfig.{name} → env). NUXT_-prefixed keys first for silent Nuxt compat.
const {NAME}_FIELDS: ConfigField<{Name}Config>[] = [
  { key: 'apiKey', env: ['NUXT_{NAME}_API_KEY', '{NAME}_API_KEY'] },
  { key: 'endpoint', env: ['NUXT_{NAME}_ENDPOINT', '{NAME}_ENDPOINT'] },
  { key: 'timeout' },
  { key: 'retries' },
]

// --- 2. Event Transformation (CONDITIONAL — delete this whole section when
// the service accepts arbitrary JSON) ------------------------------------
// If the service needs a specific shape, export a converter so it's testable
// independently. If you delete it, the encoder body becomes
// `JSON.stringify(events)` and the converter tests in test-template.md are
// dropped too — don't keep a pass-through converter for symmetry.

export interface {Name}Event {
  timestamp: string
  level: string
  data: Record<string, unknown>
}

/** Convert a WideEvent to {Name}'s event format. */
export function to{Name}Event(event: WideEvent): {Name}Event {
  const { timestamp, level, ...rest } = event
  return { timestamp, level, data: rest }
}

// --- 3. Encoder (private, shared by drain and direct-send helpers) --------
// Everything the request needs, no I/O. This single function is what keeps
// createXDrain() and sendBatchToX() in lockstep — encode parity is pinned by
// test/adapters/encode-parity.test.ts.

function encode{Name}Request(events: WideEvent[], config: {Name}Config): HttpDrainRequest {
  const endpoint = (config.endpoint ?? 'https://api.{name}.com').replace(/\/+$/, '')
  return {
    url: `${endpoint}/v1/ingest`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(events.map(to{Name}Event)),
  }
}

// --- 4. Factory built on `defineHttpDrain` ------------------------------
/**
 * Create a drain that sends wide events to [{Name}](https://{name}.com/docs).
 *
 * Configuration priority (highest to lowest):
 * 1. Overrides passed to create{Name}Drain()
 * 2. runtimeConfig.evlog.{name}
 * 3. runtimeConfig.{name}
 * 4. Environment variables: {NAME}_*
 *
 * @example
 * ```ts
 * import { create{Name}Drain } from 'evlog/{name}'
 *
 * // Zero config — set {NAME}_API_KEY env var
 * initLogger({ drain: create{Name}Drain() })
 *
 * // With overrides
 * initLogger({ drain: create{Name}Drain({ apiKey: 'my-key' }) })
 * ```
 */
export function create{Name}Drain(overrides?: Partial<{Name}Config>) {
  return defineHttpDrain<{Name}Config>({
    name: '{name}',
    label: '{Name}',
    resolve: async () => {
      const config = await resolveAdapterConfig<{Name}Config>('{name}', {NAME}_FIELDS, overrides)
      if (!config.apiKey) {
        // Returning null skips the batch: no request, no throw — but the miss
        // is logged so a misconfigured deploy is visible in the console.
        console.error(`[evlog/{name}] Missing apiKey. Set ${formatPublicEnvKeys(['NUXT_{NAME}_API_KEY', '{NAME}_API_KEY'])} env var or pass apiKey to create{Name}Drain()`)
        return null
      }
      return config as {Name}Config
    },
    encode: encode{Name}Request,
  })
}

// --- 5. Direct send helpers ----------------------------------------------
// Same encoder, same transport wrapper — never a separate fetch path.

/** Send a single wide event to {Name}. */
export async function sendTo{Name}(event: WideEvent, config: {Name}Config): Promise<void> {
  await sendBatchTo{Name}([event], config)
}

/** Send a batch of wide events to {Name} in one request. */
export async function sendBatchTo{Name}(events: WideEvent[], config: {Name}Config): Promise<void> {
  if (events.length === 0) return
  await sendEncodedDrainRequest(encode{Name}Request(events, config), {
    label: '{Name}',
    source: '{name}',
    timeout: config.timeout,
    retries: config.retries,
  })
}
```

## What `defineHttpDrain` / `sendEncodedDrainRequest` handle for you

- Normalizing `DrainContext | DrainContext[]` and early-return on empty batches
- Skipping silently when `resolve()` returns `null`
- Transport via `httpPost` (`../shared/http`): timeout (default 5000ms), retries (default 2), evlog identity headers (`User-Agent: evlog/x.y.z`, `X-Evlog-Source`)
- Error logging (`[evlog/{name}] Failed to send events:`) that never throws into the request pipeline
- A `raw` variant on the returned drain that rejects on failure and performs a single attempt (unless `retries` is set on the config). `createDrainPipeline` uses it so its retry/`onDropped` own failures; never swallow errors inside `encode` or a custom `send`

## Customization Notes

- **Auth style**: Some services use `Authorization: Bearer`, others a custom header (`X-API-Key`, ClickHouse's `X-ClickHouse-User`/`X-ClickHouse-Key`) or HTTP Basic (Loki + Grafana Cloud). Adjust `encode{Name}Request`, and prefer headers over query params so credentials never land in server-side query logs.
- **Payload format**: Raw JSON arrays (Axiom), wrapper objects (PostHog `{ api_key, batch }`), protocol structures (OTLP), NDJSON-style bodies (ClickHouse `JSONEachRow`). Adapt the encoder; export intermediate builders (`build{Name}Payload`) when the transformation is non-trivial.
- **Non-HTTP transport**: If the service cannot fit `defineHttpDrain`, use `defineDrain<TConfig>({ name, resolve, send })`, see `fs.ts` and `memory.ts`.
- **Edge safety**: no `Buffer` (use `TextEncoder` + `btoa` for Basic auth, see `toBasicCredentials` in `loki.ts`), no Node-only imports. If a runtime genuinely can't be supported, return `null` from `resolve()` with a one-time warning (see `isEdgeRuntime()` in `fs.ts`).
