---
"evlog": major
---

Each `log.audit()` call now records one action as its own event, sent right away through the request's enrichers and drains with its `requestId`, `traceId`, IP and user agent. Before, it set `audit` on the request's wide event, and a second call in the same request merged into the first. The request event no longer carries `audit`, and an audit no longer force-keeps it. Join the two on `requestId`.

`log.audit()`, `log.audit.deny()` and `audit()` return a promise that resolves once every drain has the record, and never rejects. `await` it to store the record before the response. Without `await`, evlog keeps the runtime alive with `waitUntil`, or the integration waits for it before finishing the request. `audit()` no longer returns the emitted event.

Audits are recorded on routes excluded by `include` or `exclude`, after `log.discard()`, and after the request event was emitted. In Nuxt and Nitro apps, standalone `audit()` goes through the `evlog:enrich` and `evlog:drain` hooks. An `audit` field set with `log.set()` is no longer an audit record.
