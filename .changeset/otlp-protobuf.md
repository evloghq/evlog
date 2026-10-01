---
"evlog": minor
---

Add `protocol: 'http/protobuf'` to the OTLP adapter for collectors and gateways that only accept protobuf. The protocol is also read from `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` and `OTEL_EXPORTER_OTLP_PROTOCOL`. The encoder has no dependencies and is loaded only when selected; it is also exported as `encodeOTLPLogsRequest()` from `evlog/otlp/protobuf`. Integers outside the safe integer range are now sent as `doubleValue` instead of a rounded `intValue`.
