---
"evlog": patch
---

Split Sentry log batches into envelopes of at most 100 logs. Sentry's log protocol does not allow more than 100 logs per `log` envelope, but a batch above 100 (from `batch.size` or a direct `sendBatchToSentry` call) was sent as one envelope. It is now sent as several envelopes of up to 100 logs each. Batches of 100 or fewer are unchanged.
