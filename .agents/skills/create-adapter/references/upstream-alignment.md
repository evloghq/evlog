# Upstream alignment pins

One row per drain adapter that talks to a third-party API. The row names the authority an adapter is measured against: the provider's ingest documentation, the file in the provider's own client that builds the request, and the files where that client feeds the provider's other features. `adapter-alignment` (Evi, twice a month) reads the pinned version, diffs the request shape against ours, lists every provider feature evlog does not use yet, and moves the pin forward once every difference has a destination. A new adapter adds its row in the same PR.

`fs`, `memory`, and `nuxthub` have no upstream and no row.

| Adapter | Ingest documentation | Official client | Start here | Feature entry points | Aligned to |
| --- | --- | --- | --- | --- | --- |
| `axiom.ts` | https://axiom.co/docs/restapi/ingest | `axiomhq/axiom-js` (`@axiomhq/js`) | `packages/js/src/client.ts` | the first run pins the files | @axiomhq/js 2.0.0 @ a34dffd |
| `better-stack.ts` | https://betterstack.com/docs/logs/http-rest-api/ | `logtail/logtail-js` (`@logtail/node`) | `packages/node/src/node.ts` | the first run pins the files | @logtail/node 0.5.12 @ a34dffd |
| `clickhouse.ts` | https://clickhouse.com/docs/interfaces/http | `ClickHouse/clickhouse-js` (`@clickhouse/client`) | `packages/client-common/src/client.ts`, `packages/client-node/src/connection/node_base_connection.ts` | none: a database client has no features beyond the insert | unset |
| `datadog.ts` | https://docs.datadoghq.com/api/latest/logs/#send-logs | `DataDog/datadog-api-client-typescript` (`@datadog/datadog-api-client`) | `packages/datadog-api-client-v2/apis/LogsApi.ts` | the first run pins the files | unset |
| `hyperdx.ts` | https://www.hyperdx.io/docs/install/opentelemetry | `hyperdxio/hyperdx-js` (`@hyperdx/node-logger`) | `packages/node-logger/src/logger.ts` | the first run pins the files | unset |
| `loki.ts` | https://grafana.com/docs/loki/latest/reference/loki-http-api/#ingest-logs | `grafana/alloy` (`loki.write` component; Promtail is retired) | the first run pins the file | the first run pins the files | unset |
| `otlp.ts`, `otlp-protobuf.ts` | https://opentelemetry.io/docs/specs/otlp/ | `open-telemetry/opentelemetry-js` (`@opentelemetry/exporter-logs-otlp-http`) | `experimental/packages/exporter-logs-otlp-http/src/platform/node/OTLPLogExporter.ts`, `experimental/packages/otlp-exporter-base/src/configuration/otlp-http-configuration.ts` | the first run pins the files | unset |
| `posthog.ts` | https://posthog.com/docs/api/capture | `PostHog/posthog-js` (`posthog-node`) | `packages/node/src/client.ts`, `packages/core/src/posthog-core.ts` | the first run pins the files | unset |
| `sazabi.ts` | https://docs.sazabi.com (OTLP/HTTP log streams) | none: OTLP/HTTP through evlog's own encoder (`otlp.ts`) | `packages/evlog/src/adapters/otlp.ts` | none: no client of its own | unset |
| `sentry.ts` | https://develop.sentry.dev/sdk/data-model/envelopes/ | `getsentry/sentry-javascript` (`@sentry/core`) | `packages/core/src/logs/envelope.ts`, `packages/core/src/logs/internal.ts`, `packages/core/src/envelope.ts`, `packages/core/src/transports/base.ts` | the first run pins the files | unset |

`Aligned to` is the client's published version and the evlog commit that last matched it, written as `@sentry/core 11.2.0 @ 5e0d543`. `unset` means no run has compared the two yet; the first run over that adapter writes the first pin and files every mismatch and gap it finds along the way.

First in line, when several rows tie on `Aligned to`: `sentry.ts`, `datadog.ts`, `posthog.ts`, `otlp.ts`. These are the providers most evlog users drain to, and the ones whose products offer the most beyond storing a log line. Every other tie goes by table order.

## What a comparison covers

Read both sides for the same request and record each difference as a mismatch with the upstream line as evidence:

- endpoint, path, and the default region or site;
- authentication header name and scheme;
- content type, compression, and batch limits (bytes, events, or both);
- the field each side uses for timestamp, level, message, service, and attributes, and how nested objects are shaped;
- the level or severity mapping;
- retry, backoff, and the status codes that stop a retry;
- user-agent or SDK identification headers the provider documents as expected;
- options the provider deprecated or renamed since the pin.

A mismatch where evlog is more conservative than the client (a smaller batch, a stricter timeout) is a note, not a finding. A mismatch that changes what the provider stores or how it indexes is a finding.

## What a capability check covers

The goal is that an evlog user gets the most out of the provider they chose. Read the provider's product docs for every feature it offers, then the `Feature entry points` files for how its client feeds them. Log ingestion is one feature among many. For each of these, ask whether evlog uses it:

- errors the provider groups into issues or error tracking, with their stack, fingerprint, and the status codes the client skips;
- alerts and monitors the provider can raise from what we send;
- metrics, counters, and durations the provider charts natively instead of from log fields;
- trace or span context the provider links to its own traces;
- the user, account, or person the provider attaches events to;
- release, environment, and deploy markers the provider tracks over time;
- the fields the provider indexes, facets, or reserves (service, host, status, tags), and whether evlog fills them;
- sampling, retention, and cost controls the provider exposes at ingest;
- any other item type or endpoint the provider accepts.

Each one evlog does not use is a gap, filed as a proposal. A gap is not a defect in the adapter: it is a decision about a feature, so it never becomes a PR on its own. A feature that does not fit evlog is recorded once as a choice, with the reason.
