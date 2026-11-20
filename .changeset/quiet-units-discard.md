---
'evlog': minor
---

Jobs and other Effect units can drop their own success events, and keep failures.

- `log.discard()` makes the logger skip the event when the unit succeeds or is interrupted. A later `error()` or `fatal()` still emits, and `discard()` wins over `sampling.keep` and head sampling, so an idle run costs no event while a failure stays visible.
- `withLogger(action, { emit: 'onError' })` emits only on failure. A failure bypasses head sampling, so `sampling.rates.error: 0` cannot drop it, and successful or interrupted runs emit nothing.
