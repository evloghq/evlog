---
'@evlog/signals': patch
---

Fix two cases where `@evlog/signals` judged fewer or more events than documented.

- Concurrent events sharing a `cacheKey` now share one model call. The verdict used to be cached only after the first call returned, so an error storm of identical events made one call per event. Events that wait on a running call count in `stats().cached`.
- A refusal from the model (`Experimental_DecisionRefusalError`, `ai` 7.0.130 and later) no longer opens the breaker. It used to count as a failed call and skip every event for `budget.cooldownMs`. A refused call records no verdict and counts in the new `stats().refused`.
