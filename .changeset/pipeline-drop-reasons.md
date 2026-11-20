---
'evlog': patch
---

`createDrainPipeline` reports every event it drops.

- `onDropped(events, error, reason)` gets a third argument: `'buffer-full'`, `'rejected'` (a status such as `400` that no retry fixes), `'retries-exhausted'` or `'rate-limited'` (`flush()` ran during a provider's `Retry-After`). Existing two-argument callbacks keep working.
- Without `onDropped`, buffer overflow used to drop events with no log line. Every drop is now logged with `console.error`, at most once a minute with the count per reason, and once more on `flush()` for what is left.
- `drain.stats()` returns `{ delivered, dropped }`, the events delivered and dropped per reason since the pipeline was created.
