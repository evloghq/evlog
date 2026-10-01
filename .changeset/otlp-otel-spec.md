---
'evlog': minor
---

Align the OTLP adapter with the OpenTelemetry exporter specification. `createOTLPDrain()` now reads `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` (used as the full logs URL, without appending `/v1/logs`), `OTEL_EXPORTER_OTLP_LOGS_HEADERS` (merged over `OTEL_EXPORTER_OTLP_HEADERS`) and `OTEL_RESOURCE_ATTRIBUTES`, so a deployment already configured for an OTel SDK needs no evlog-specific variables. A new `compression: 'gzip'` option, also read from `OTEL_EXPORTER_OTLP_[LOGS_]COMPRESSION`, gzips the request body.

Fix attribute encoding in the OTLP, HyperDX and PostHog adapters: non-integer numbers are sent as `doubleValue` instead of strings, and arrays of a single primitive type as `arrayValue`, so backends can aggregate and filter on them. Malformed or all-zero `traceId` / `spanId` values are kept as attributes instead of being placed in the record's trace fields, where collectors reject them. Events that differ in `version`, `region` or `commitHash` no longer share a resource, and the instrumentation scope carries the evlog version.
