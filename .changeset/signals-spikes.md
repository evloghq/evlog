---
'@evlog/signals': minor
---

Traffic spikes no longer starve keep signals or flood the model.

- `budget.keepShare` (default `0.25`) holds part of `perMinute` for keep signals, so an error storm judged in `enrich` cannot spend it.
- `budget.maxConcurrent` (default `16`) caps calls in flight. Events past it pass through unjudged and count as `skipped`.
- The budget bucket holds 10 seconds of `perMinute` instead of the whole minute, so a spike after a quiet period spends at most a sixth of it at once.
- Under a spike, events are judged with the probability the budget can afford instead of first come, first served. A verdict judged after skipped events carries `rate` on its column: `sum(1 / rate)` estimates the count.
- A skipped event no longer serializes its state.
- `errorFingerprint` is a ready-made `cacheKey` that keys on the error with ids, timestamps and numbers stripped: `cacheKey: errorFingerprint`.
