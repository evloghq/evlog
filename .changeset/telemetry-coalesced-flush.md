---
'@evlog/telemetry': minor
---

`run()` writes every event to the on-disk outbox and POSTs only when the last successful flush is older than 15 minutes (60 minutes in CI) or 20 events have queued, capped at 50 per POST. Failed uploads stay on disk for the next command. `flush()` still sends immediately. Override the window with `flushIntervalMs` or `EVLOG_TELEMETRY_FLUSH_INTERVAL_MS`.
