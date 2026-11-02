export interface DrainEntry {
  id: string
  name: string
  /** The entry point the factory is imported from. */
  entry: string
  factory: string
  /** Environment variables the drain needs, with a placeholder value. */
  env: [string, string][]
  /** One line on what the destination is good at. */
  note: string
  to: string
  group: 'Hosted' | 'OpenTelemetry' | 'Your own'
}

/** Every drain that ships with evlog, as the Drains overview lists them. Values come from the adapters. */
export const drains: DrainEntry[] = [
  { id: 'axiom', name: 'Axiom', entry: 'evlog/axiom', factory: 'createAxiomDrain', env: [['AXIOM_API_KEY', 'xaat-...'], ['AXIOM_DATASET', 'my-app']], note: 'Every field queryable on arrival, no schema', to: '/drains/axiom', group: 'Hosted' },
  { id: 'posthog', name: 'PostHog', entry: 'evlog/posthog', factory: 'createPostHogDrain', env: [['POSTHOG_API_KEY', 'phc_...']], note: 'Logs on the person and next to their session replay', to: '/drains/posthog', group: 'Hosted' },
  { id: 'sentry', name: 'Sentry', entry: 'evlog/sentry', factory: 'createSentryDrain', env: [['SENTRY_DSN', 'https://key@o0.ingest.sentry.io/0']], note: 'Logs, and an issue for each server error', to: '/drains/sentry', group: 'Hosted' },
  { id: 'datadog', name: 'Datadog', entry: 'evlog/datadog', factory: 'createDatadogDrain', env: [['DD_API_KEY', '...'], ['DD_SITE', 'datadoghq.com']], note: 'Fields become log attributes you can facet on', to: '/drains/datadog', group: 'Hosted' },
  { id: 'better-stack', name: 'Better Stack', entry: 'evlog/better-stack', factory: 'createBetterStackDrain', env: [['BETTER_STACK_API_KEY', '...']], note: 'Each field a column to filter and chart', to: '/drains/better-stack', group: 'Hosted' },
  { id: 'otlp', name: 'OTLP', entry: 'evlog/otlp', factory: 'createOTLPDrain', env: [['OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318']], note: 'Any collector: Grafana, Honeycomb, New Relic', to: '/drains/otlp', group: 'OpenTelemetry' },
  { id: 'hyperdx', name: 'HyperDX', entry: 'evlog/hyperdx', factory: 'createHyperDXDrain', env: [['HYPERDX_API_KEY', '...']], note: 'OTLP, cloud or self-hosted', to: '/drains/hyperdx', group: 'OpenTelemetry' },
  { id: 'sazabi', name: 'Sazabi', entry: 'evlog/sazabi', factory: 'createSazabiDrain', env: [['SAZABI_INTAKE_URL', 'https://key.us-west-2.intake.sazabi.com']], note: 'OTLP to a log stream; the URL is the credential', to: '/drains/sazabi', group: 'OpenTelemetry' },
  { id: 'loki', name: 'Grafana Loki', entry: 'evlog/loki', factory: 'createLokiDrain', env: [['LOKI_ENDPOINT', 'http://localhost:3100']], note: 'A few labels, the whole event as JSON', to: '/drains/loki', group: 'Your own' },
  { id: 'clickhouse', name: 'ClickHouse', entry: 'evlog/clickhouse', factory: 'createClickHouseDrain', env: [['CLICKHOUSE_ENDPOINT', 'http://localhost:8123']], note: 'Rows you query with SQL', to: '/drains/clickhouse', group: 'Your own' },
  { id: 'fs', name: 'File system', entry: 'evlog/fs', factory: 'createFsDrain', env: [], note: 'NDJSON in .evlog/logs, for you and your agent', to: '/drains/fs', group: 'Your own' },
  { id: 'memory', name: 'Memory', entry: 'evlog/memory', factory: 'createMemoryDrain', env: [], note: 'A ring buffer to assert on in tests', to: '/drains/memory', group: 'Your own' },
]
