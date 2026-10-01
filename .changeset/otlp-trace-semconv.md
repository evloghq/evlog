---
'evlog': minor
---

`createTraceContextEnricher()` no longer sets `event.spanId` from an incoming `traceparent`. That span belongs to the caller, so linking the event to it pointed log-to-span correlation one level too high. The id is now recorded as `event.parentSpanId` (and `traceContext.parentSpanId`), and `event.spanId` is left for your tracer to set from the active server span, for example `trace.getActiveSpan()?.spanContext().spanId` with OpenTelemetry. If you relied on the enricher for `spanId` in the OTLP or Datadog adapters, set it from the active span.

The OTLP adapter's default `json` record shape now sends nested objects as OTLP key-value lists (`kvlistValue`) instead of JSON strings, so collectors and backends can read their fields. The `compact` shape is unchanged.

A new `semanticConventions: true` option on `createOTLPDrain()` adds OpenTelemetry semantic convention attributes next to the evlog field names: `http.request.method`, `url.path`, `http.response.status_code`, `user_agent.original`, `exception.*` and `gen_ai.*` (model, provider, response id, token usage, finish reasons), plus the `deployment.environment.name` resource attribute. It becomes the default in the next major.
