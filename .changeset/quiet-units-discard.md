---
'evlog': minor
---

A unit of work can drop its own wide event, and Effect jobs can emit only on failure.

- `log.discard()` drops the event when the unit ends without an error. `error()`, `fatal()` and `audit()` still emit, so a failure or an audit record is never lost. A discarded event skips the tail `keep` hooks and plugins, `sampling.keep` and head sampling, so an idle run makes no keep call and drains nothing. Every integration and `withLogger` respect it.
- `withLogger(action, { emit: 'onError' })` emits only when the effect fails or dies, or the unit records `log.error()`. That event bypasses sampling, so `sampling.rates.error: 0` cannot drop it. Successful and interrupted runs emit nothing.
