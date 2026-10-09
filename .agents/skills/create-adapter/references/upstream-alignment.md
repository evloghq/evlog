# Upstream alignment pins

One row per drain adapter that talks to a third-party API. The row names the authority an adapter is measured against: the provider's ingest documentation and the file in the provider's own client that builds the request. `adapter-alignment` (Evi, twice a month) reads the pinned version, diffs the request shape against ours, and moves the pin forward once the two agree. A new adapter adds its row in the same PR.

`fs`, `memory`, and `nuxthub` have no upstream and no row.

| Adapter | Ingest documentation | Official client | Start here | Aligned to |
| --- | --- | --- | --- | --- |
| `axiom.ts` | https://axiom.co/docs/restapi/ingest | `axiomhq/axiom-js` (`@axiomhq/js`) | `packages/js/src/client.ts` | @axiomhq/js 2.0.0 @ a34dffd |
| `better-stack.ts` | https://betterstack.com/docs/logs/http-rest-api/ | `logtail/logtail-js` (`@logtail/node`) | `packages/node/src/node.ts` | @logtail/node 0.5.12 @ a34dffd |
| `clickhouse.ts` | https://clickhouse.com/docs/interfaces/http | `ClickHouse/clickhouse-js` (`@clickhouse/client`) | `packages/client-common/src/client.ts`, `packages/client-node/src/connection/node_base_connection.ts` | unset |
| `datadog.ts` | https://docs.datadoghq.com/api/latest/logs/#send-logs | `DataDog/datadog-api-client-typescript` (`@datadog/datadog-api-client`) | `packages/datadog-api-client-v2/apis/LogsApi.ts` | unset |
| `hyperdx.ts` | https://www.hyperdx.io/docs/install/opentelemetry | `hyperdxio/hyperdx-js` (`@hyperdx/node-logger`) | `packages/node-logger/src/logger.ts` | unset |
| `loki.ts` | https://grafana.com/docs/loki/latest/reference/loki-http-api/#ingest-logs | `grafana/alloy` (`loki.write` component; Promtail is retired) | the first run pins the file | unset |
| `otlp.ts`, `otlp-protobuf.ts` | https://opentelemetry.io/docs/specs/otlp/ | `open-telemetry/opentelemetry-js` (`@opentelemetry/exporter-logs-otlp-http`) | `experimental/packages/exporter-logs-otlp-http/src/platform/node/OTLPLogExporter.ts`, `experimental/packages/otlp-exporter-base/src/configuration/otlp-http-configuration.ts` | unset |
| `posthog.ts` | https://posthog.com/docs/api/capture | `PostHog/posthog-js` (`posthog-node`) | `packages/node/src/client.ts`, `packages/core/src/posthog-core.ts` | unset |
| `sentry.ts` | https://develop.sentry.dev/sdk/data-model/envelopes/ | `getsentry/sentry-javascript` (`@sentry/core`) | `packages/core/src/envelope.ts`, `packages/core/src/transports/base.ts` | unset |

`Aligned to` is the client's published version and the evlog commit that last matched it, written as `@sentry/core 11.2.0 @ 5e0d543`. `unset` means no run has compared the two yet; the first run over that adapter writes the first pin and files every mismatch it finds along the way.

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
