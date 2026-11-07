---
"evlog": patch
---

Split adapter batches at each provider's documented per-request limits. A batch above a limit was sent as one request and rejected (usually `413`), and the pipeline dropped it. It is now sent as several requests that each fit:

- Datadog: 1000 entries and 5 MB uncompressed per request (the byte cap is new).
- Sentry: 100 logs and 1 MiB of log payload per envelope (the byte cap is new).
- Axiom: 10,000 events per request.
- Better Stack: 10 MiB per request.
- PostHog `mode: 'events'`: request bodies under 20 MB on `/batch/`.

Batches within the limits send the same single request as before. Retry behavior is unchanged: the drain path keeps its default retries and the pipeline path sends one attempt unless `retries` is set. A single event larger than the limit is still sent on its own, so the provider decides what to do with it.
