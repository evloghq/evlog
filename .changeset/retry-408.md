---
"evlog": patch
---

HTTP drains now retry a `408 Request Timeout` response, with the same backoff and attempt limit as `429` and `5xx`. A `408` used to fail the request on the first attempt and drop the batch. This covers every drain built on the shared HTTP client: Axiom, Better Stack, ClickHouse, Datadog, HyperDX, Loki, OTLP, PostHog, Sazabi and Sentry. Other `4xx` responses are still not retried.
