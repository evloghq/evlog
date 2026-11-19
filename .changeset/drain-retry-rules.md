---
'evlog': patch
---

HTTP drains retry only failures that can succeed later, and wait as long as the provider asks.

- Retried: network errors, timeouts, and `408`, `429`, `502`, `503` and `504` responses, plus Datadog's `500`, which its intake documents as retryable. Any other status, such as a `400` for a malformed payload, is sent once. Inside `createDrainPipeline` a `400` used to cost `retry.maxAttempts` requests before the batch was dropped; it now goes to `onDropped` after one. A plain `500` is no longer retried outside Datadog.
- `Retry-After` (seconds or an HTTP date) replaces the backoff delay. In `createDrainPipeline`, a `Retry-After` longer than `retry.maxDelayMs` pauses the pipeline and keeps the batch buffered until the delay has passed, where it used to retry after 1 s and 3 s and then drop the batch. `flush()` does not wait out a pause: it hands the buffered events to `onDropped`.
- Retry delays are jittered, between half and all of the configured backoff.
- HyperDX, Sazabi and PostHog logs (`mode: 'logs'`) make one request per pipeline attempt, like the other adapters. Against a failing backend, one event cost 9 requests inside a default pipeline; it now costs 3.
- `httpPost` throws a `DrainDeliveryError` (exported from `evlog/toolkit`) carrying `status`, `retryable`, `retryAfterMs` and the response `headers`. The message is unchanged. A custom drain can throw one with `retryable: false` so the pipeline drops the batch without retrying. Plain errors thrown by a custom drain are retried as before.
