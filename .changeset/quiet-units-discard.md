---
'evlog': minor
---

Jobs and other Effect units can drop their own success events, and keep failures.

- `log.discard()` makes the logger skip the event when the unit succeeds or is interrupted. A later `error()` or `fatal()`, or an explicit `setLevel('error')` / `setLevel('fatal')`, still emits and bypasses head sampling, so `sampling.rates.error: 0` cannot hide a failure. `discard()` wins over `sampling.keep` and head sampling for the successful run.
- `withLogger(action, { emit: 'onError' })` emits only on failure. A failure bypasses head sampling, so `sampling.rates.error: 0` cannot drop it, and successful or interrupted runs emit nothing.
