---
"evlog": patch
---

Send the evlog SDK identity to Sentry. Every log now carries `sentry.sdk.name` (`evlog`) and `sentry.sdk.version` attributes, which Sentry's log protocol requires on every log, and each envelope header carries an `sdk` field. Logs also carry the event's `span_id` when the event has one, so Sentry can link a log to its span. Existing fields are unchanged, so no setup change is needed.
