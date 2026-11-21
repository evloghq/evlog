---
'@evlog/signals': minor
---

Typed verdicts in code, a `keep` threshold shorthand, cache expiry, and one model call for kept events. Requires `ai` 7.0.130 or later.

- `signal.read(event)` returns the signal's column from a judged event, typed on its options or levels: `retryable.read(event)?.value`.
- On yes/no signals, `keep: 0.8` is short for `keep: v => v.value && v.confidence > 0.8`.
- `createSignals({ cacheTtlMs })` sets how long a `cacheKey` verdict is reused. Default 5 minutes; verdicts used to be kept until 1,000 newer ones pushed them out.
- When a keep signal is due, the other due signals are asked in the same call, so a kept event costs one call instead of two.
- `budget.perMinute` is a token bucket refilled evenly over the minute, instead of a fixed window that allowed up to twice the limit across a window boundary.
- The breaker opens after three failed calls in a row instead of after one.
- Keep signals see `path` and `method` from the sampling context when the request context does not carry them.
- Calls go through the AI SDK's `experimental_decide`, which replaced the deprecated `experimental_evaluate`. The peer dependency on `ai` moves from 7.0.105 to 7.0.130.
