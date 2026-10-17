import type { ProjectFacts } from '../map/project-facts'
import type { Framework } from '../map/types'

/**
 * Everything `init` can offer, as data.
 *
 * One catalog drives both surfaces — the prompts render from it and the flags
 * validate against it — so the two cannot drift.
 */

export type DrainId =
  | 'fs'
  | 'axiom'
  | 'otlp'
  | 'posthog'
  | 'sentry'
  | 'better-stack'
  | 'datadog'
  | 'hyperdx'
  | 'sazabi'
  | 'loki'
  | 'clickhouse'
  | 'none'

export interface Destination {
  id: DrainId
  label: string
  /** One line under the label in the picker — what you get, not what it is. */
  hint: string
  /** Import specifier, `null` for the console-only choice. */
  specifier: string | null
  /** Factory to call in the generated code. */
  factory: string | null
  /** Environment variables the adapter reads. Never prompted for — see the env note. */
  env: { name: string, hint: string }[]
  docs: string
  /** The filesystem drain is not: it writes files on whatever box serves the request. */
  productionSafe: boolean
}

export const DESTINATIONS: readonly Destination[] = [
  {
    id: 'fs',
    label: 'Local files',
    hint: 'NDJSON under .evlog/logs — no account, works offline',
    specifier: 'evlog/fs',
    factory: 'createFsDrain()',
    env: [],
    docs: '/integrate/adapters/self-hosted/fs',
    productionSafe: false,
  },
  {
    id: 'axiom',
    label: 'Axiom',
    hint: 'Wide events you can query with APL',
    specifier: 'evlog/axiom',
    factory: 'createAxiomDrain()',
    env: [
      { name: 'AXIOM_DATASET', hint: 'dataset to write to' },
      { name: 'AXIOM_API_KEY', hint: 'API token with ingest permission' },
    ],
    docs: '/integrate/adapters/cloud/axiom',
    productionSafe: true,
  },
  {
    id: 'otlp',
    label: 'OpenTelemetry (OTLP)',
    hint: 'Any OTLP collector — vendor-neutral',
    specifier: 'evlog/otlp',
    factory: 'createOTLPDrain()',
    env: [
      { name: 'OTEL_EXPORTER_OTLP_ENDPOINT', hint: 'collector URL' },
      { name: 'OTEL_SERVICE_NAME', hint: 'defaults to your evlog service name' },
    ],
    docs: '/integrate/adapters/hybrid/otlp',
    productionSafe: true,
  },
  {
    id: 'posthog',
    label: 'PostHog',
    hint: 'Product analytics and logs in one place',
    specifier: 'evlog/posthog',
    factory: 'createPostHogDrain()',
    env: [
      { name: 'POSTHOG_API_KEY', hint: 'project API key' },
      { name: 'POSTHOG_HOST', hint: 'defaults to PostHog cloud' },
    ],
    docs: '/integrate/adapters/cloud/posthog',
    productionSafe: true,
  },
  {
    id: 'sentry',
    label: 'Sentry',
    hint: 'Errors with the full wide event attached',
    specifier: 'evlog/sentry',
    factory: 'createSentryDrain()',
    env: [{ name: 'SENTRY_DSN', hint: 'project DSN' }],
    docs: '/integrate/adapters/cloud/sentry',
    productionSafe: true,
  },
  {
    id: 'better-stack',
    label: 'Better Stack',
    hint: 'Logtail ingest with live tail',
    specifier: 'evlog/better-stack',
    factory: 'createBetterStackDrain()',
    env: [{ name: 'BETTER_STACK_API_KEY', hint: 'source token' }],
    docs: '/integrate/adapters/cloud/better-stack',
    productionSafe: true,
  },
  {
    id: 'datadog',
    label: 'Datadog',
    hint: 'Logs intake, correlated with your APM traces',
    specifier: 'evlog/datadog',
    factory: 'createDatadogDrain()',
    env: [
      { name: 'DATADOG_API_KEY', hint: 'API key' },
      { name: 'DATADOG_SITE', hint: 'e.g. datadoghq.eu' },
    ],
    docs: '/integrate/adapters/cloud/datadog',
    productionSafe: true,
  },
  {
    id: 'hyperdx',
    label: 'HyperDX',
    hint: 'OTLP-native, session replay alongside logs',
    specifier: 'evlog/hyperdx',
    factory: 'createHyperDXDrain()',
    env: [{ name: 'HYPERDX_API_KEY', hint: 'ingestion key' }],
    docs: '/integrate/adapters/hybrid/hyperdx',
    productionSafe: true,
  },
  {
    id: 'sazabi',
    label: 'Sazabi',
    hint: 'AI-native log search over OTLP',
    specifier: 'evlog/sazabi',
    factory: 'createSazabiDrain()',
    env: [{ name: 'SAZABI_INTAKE_URL', hint: 'intake URL' }],
    docs: '/integrate/adapters/cloud/sazabi',
    productionSafe: true,
  },
  {
    id: 'loki',
    label: 'Grafana Loki',
    hint: 'Log streams queried with LogQL',
    specifier: 'evlog/loki',
    factory: 'createLokiDrain()',
    env: [{ name: 'LOKI_ENDPOINT', hint: 'Loki endpoint URL' }],
    docs: '/integrate/adapters/hybrid/loki',
    productionSafe: true,
  },
  {
    id: 'clickhouse',
    label: 'ClickHouse',
    hint: 'Wide events as rows in your own table',
    specifier: 'evlog/clickhouse',
    factory: 'createClickHouseDrain()',
    env: [{ name: 'CLICKHOUSE_ENDPOINT', hint: 'HTTP endpoint; the evlog_events table must exist first' }],
    docs: '/integrate/adapters/hybrid/clickhouse',
    productionSafe: true,
  },
  {
    id: 'none',
    label: 'Nothing yet',
    hint: 'Pretty console output only — wire a drain when you are ready',
    specifier: null,
    factory: null,
    env: [],
    docs: '/integrate/adapters/overview',
    productionSafe: true,
  },
]

export function findDestination(id: string): Destination | undefined {
  return DESTINATIONS.find(destination => destination.id === id)
}

/** Destinations offered for local development — the file sink, or nothing. */
export const DEV_DESTINATIONS = DESTINATIONS.filter(d => d.id === 'fs' || d.id === 'none')

/** Production destinations. The filesystem sink is deliberately absent. */
export const PROD_DESTINATIONS = DESTINATIONS.filter(d => d.productionSafe && d.factory !== null)

/* ── enrichers ──────────────────────────────────────────────────────────── */

export type EnricherId = 'user-agent' | 'geo' | 'request-size' | 'trace-context'

export interface Enricher {
  id: EnricherId
  label: string
  hint: string
  factory: string
}

export const ENRICHERS: readonly Enricher[] = [
  {
    id: 'user-agent',
    label: 'User agent',
    hint: 'Browser, OS and device, parsed from the header',
    factory: 'createUserAgentEnricher()',
  },
  {
    id: 'geo',
    label: 'Geo',
    hint: 'Country and region from CDN headers — no lookup, no cost',
    factory: 'createGeoEnricher()',
  },
  {
    id: 'request-size',
    label: 'Request size',
    hint: 'Bytes in and out — cheap, and it finds the payloads nobody expected',
    factory: 'createRequestSizeEnricher()',
  },
  {
    id: 'trace-context',
    label: 'Trace context',
    hint: 'W3C traceparent, so events line up with your traces',
    factory: 'createTraceContextEnricher()',
  },
]

export const DEFAULT_ENRICHERS: readonly EnricherId[] = ['user-agent', 'geo', 'request-size', 'trace-context']

export function findEnricher(id: string): Enricher | undefined {
  return ENRICHERS.find(enricher => enricher.id === id)
}

/* ── sampling ───────────────────────────────────────────────────────────── */

export type SamplingProfile = 'all' | 'low' | 'medium' | 'high' | 'very-high'

export interface SamplingPreset {
  id: SamplingProfile
  label: string
  hint: string
  /**
   * Rates to write, or `null` for "keep everything".
   *
   * `debug` is absent on purpose: an unspecified level is kept at 100%, and
   * debug events only exist because somebody turned them on to chase something.
   */
  rates: { info: number, warn: number } | null
}

/**
 * Named by the traffic the app takes, not by the ratio.
 *
 * Errors stay at 100% in every tier. Info is what moves across the ladder;
 * warnings only give way at the top.
 */
export const SAMPLING_PRESETS: readonly SamplingPreset[] = [
  {
    id: 'all',
    label: 'Everything',
    hint: 'No sampling — the right answer until volume or cost says otherwise',
    rates: null,
  },
  {
    id: 'low',
    label: 'Low traffic',
    hint: 'Half the info events, every warning — a small app that has started to repeat itself',
    rates: { info: 50, warn: 100 },
  },
  {
    id: 'medium',
    label: 'Medium traffic',
    hint: '1 info event in 4, every warning — steady traffic with a bill worth watching',
    rates: { info: 25, warn: 100 },
  },
  {
    id: 'high',
    label: 'High traffic',
    hint: '1 info event in 10, every warning — info is most of what you are paying for',
    rates: { info: 10, warn: 100 },
  },
  {
    id: 'very-high',
    label: 'Very high traffic',
    hint: '1 info event in 100 and half the warnings — trends rather than individual requests',
    rates: { info: 1, warn: 50 },
  },
]

export function findSamplingPreset(id: string): SamplingPreset | undefined {
  return SAMPLING_PRESETS.find(preset => preset.id === id)
}

/* ── extras ─────────────────────────────────────────────────────────────── */

export type ExtraId =
  | 'enrichers'
  | 'pipeline'
  | 'sampling'
  | 'vite'
  | 'error-catalog'
  | 'audit-catalog'
  | 'ai'
  | 'better-auth'

/** Heading the extra is listed under in the picker. */
export type ExtraGroup = 'Context' | 'Delivery' | 'Catalogs' | 'Build' | 'Integrations'

export interface Extra {
  id: ExtraId
  group: ExtraGroup
  label: string
  hint: string
  docs: string
  /** Frameworks this makes sense for; omitted means all of them. */
  frameworks?: readonly Framework[]
  /** Only offered when production events actually leave the process. */
  requiresProdDrain?: true
}

export const EXTRAS: readonly Extra[] = [
  {
    id: 'enrichers',
    group: 'Context',
    label: 'Request enrichers',
    hint: 'User agent, geo, size, trace context — you pick which',
    docs: '/use-cases/enrichers',
  },
  {
    id: 'pipeline',
    group: 'Delivery',
    label: 'Batching and retry',
    hint: 'Buffer events and retry failed sends instead of one HTTP call per request',
    docs: '/extend/drain-pipeline',
    requiresProdDrain: true,
  },
  {
    id: 'sampling',
    group: 'Delivery',
    label: 'Sampling',
    hint: 'Keep every error, a fraction of the healthy traffic',
    docs: '/learn/sampling',
  },
  {
    id: 'error-catalog',
    group: 'Catalogs',
    label: 'Error catalog',
    hint: 'Turn the errors you already repeat across files into typed entries',
    docs: '/learn/catalogs',
  },
  {
    id: 'audit-catalog',
    group: 'Catalogs',
    label: 'Audit actions',
    hint: 'Typed actions for the sensitive routes that have no trail yet',
    docs: '/use-cases/audit/overview',
  },
  {
    id: 'vite',
    group: 'Build',
    label: 'Vite plugin',
    hint: 'Strip log.debug() from production builds, inject source locations',
    docs: '/reference/vite-plugin',
    frameworks: ['tanstack-start'],
  },
  {
    id: 'ai',
    group: 'Integrations',
    label: 'AI SDK logging',
    hint: 'Token usage, tool calls and cost on every generation',
    docs: '/use-cases/ai-sdk/overview',
  },
  {
    id: 'better-auth',
    group: 'Integrations',
    label: 'Auth identity',
    hint: 'Attach the signed-in user to every event automatically',
    docs: '/use-cases/better-auth/overview',
  },
]

export function findExtra(id: string): Extra | undefined {
  return EXTRAS.find(extra => extra.id === id)
}

/** What the project looks like, as far as deciding what to offer goes. */
export interface OfferContext {
  framework: Framework
  /** Production destinations chosen — empty means nothing leaves the process. */
  prodDrains: DrainId[]
  /** What the scan found, or `null` when it has not run. */
  facts: ProjectFacts | null
  /** Sensitive entry points with no audit trail, from the same scan. */
  auditGaps: number
}

/**
 * The extras worth showing for this project.
 *
 * Gated on evidence: integrations need their package installed, catalogs need
 * the scan to have found something to seed them with.
 */
export function availableExtras(context: OfferContext): Extra[] {
  return EXTRAS.filter((extra) => {
    if (extra.frameworks && !extra.frameworks.includes(context.framework)) return false
    if (extra.requiresProdDrain && context.prodDrains.length === 0) return false

    switch (extra.id) {
      case 'ai': return context.facts?.pairable.has('ai') ?? false
      case 'better-auth': return context.facts?.pairable.has('better-auth') ?? false
      /* One inline error is a local decision; the same one in three handlers is
         a catalog entry nobody has written yet. */
      case 'error-catalog': return (context.facts?.repeatedErrors.size ?? 0) > 0
      case 'audit-catalog': return context.auditGaps > 0
      default: return true
    }
  })
}

/** A count to put next to an offer, so the reason it is there is visible. */
export function offerEvidence(extra: Extra, context: OfferContext): string | null {
  switch (extra.id) {
    case 'error-catalog': {
      const count = context.facts?.repeatedErrors.size ?? 0
      return count > 0 ? `${count} repeated error${count === 1 ? '' : 's'} found` : null
    }
    case 'audit-catalog':
      return context.auditGaps > 0 ? `${context.auditGaps} sensitive route${context.auditGaps === 1 ? '' : 's'} with no trail` : null
    case 'ai': return 'ai is installed'
    case 'better-auth': return 'better-auth is installed'
    default: return null
  }
}
