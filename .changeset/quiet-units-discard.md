---
'evlog': minor
---

Jobs and other Effect units can drop their own success events, and keep failures.

- `log.discard()` makes the logger skip the event when the unit succeeds or is interrupted. A later `error()` or `fatal()`, an explicit `setLevel('error')` / `setLevel('fatal')`, or an `audit()` record still emits and bypasses head sampling, so `sampling.rates.error: 0` cannot hide a failure and an audit record is never dropped. `discard()` wins over `sampling.keep` and head sampling only for a run with none of those.
- `withLogger(action, { emit: 'onError' })` emits on failure. A failure bypasses head sampling, so `sampling.rates.error: 0` cannot drop it. A successful or interrupted run is discarded as with `log.discard()`, so it emits nothing unless it recorded an `error()`, a `fatal()` or an `audit()`.
