# OpenTelemetry

Checked: 2026-09-08 · Source: https://opentelemetry.io/docs/

Not a competitor, and the page that treats it as one loses the reader who runs a collector. evlog ships an OTLP drain, so the true relationship is "evlog speaks this".

## What it does

- Three signals: traces, metrics, logs. A span carries a name, a duration, a status, and attributes.
- Semantic conventions standardize shared attributes such as `http.request.method`, `server.address`, and `error.type`. Custom application attributes are valid too. Query support depends on the backend.
- SDKs instrument the runtime; the Collector receives, processes, and exports. OTLP is the wire protocol, over gRPC or HTTP.
- Trace sampling can be head-based at the SDK or tail-based in the Collector. Do not equate trace sampling with log-event sampling.
- Context propagation carries `traceparent` across services.

## Where evlog sits

- A wide event is a log record, while a span represents a timed operation in a trace. Both can carry application attributes. evlog does not create spans or metrics.
- `evlog/otlp` exports logs over OTLP HTTP to `/v1/logs`, not to gRPC-only endpoints, so an evlog event lands next to spans the rest of the stack already emits.
- The `TraceContext` enricher reads the incoming `traceparent`, which can associate an event with a trace someone else started. Its incoming parent span ID is not necessarily the active server span ID. Use the active OTel SDK context for that association.

## What we must never say

- That OpenTelemetry is heavy, complicated, or overkill. That is a positioning line, not a claim, and the reader running a collector reads it as ignorance.
- That evlog replaces it. It exports to it.
- That attribute naming is arbitrary. Semantic conventions exist and a page inventing field names next to them is teaching the reader a habit their vendor will punish.
