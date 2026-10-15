---
"evlog": patch
---

Split Datadog log batches into requests of at most 1000 entries. The Logs intake accepts at most 1000 entries per request, but a batch above 1000 (from `batch.size` or a direct `sendBatchToDatadog` call) was sent as one request. It is now sent as several requests of up to 1000 entries each. Batches of 1000 or fewer are unchanged, and retry behavior is unchanged.
