---
'evlog': minor
---

Add `fatal` and `trace` log levels. `log.fatal()` emits an error-level event that sampling always keeps, and `log.trace()` emits a debug-level event that is dropped by default; opt in with `sampling.rates.trace`. Both levels flow through console output, colors, OTLP severity mapping, Datadog status mapping and the ingest validation, and the request logger accepts `fatal()` and `trace()` entries (`trace` never raises the event level, `fatal` escalates it above `error`).
