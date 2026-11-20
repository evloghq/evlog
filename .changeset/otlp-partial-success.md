---
'evlog': patch
---

The OTLP drain reads the `partialSuccess` an OTLP collector can return with a `2xx`, in JSON and protobuf responses. HyperDX, Sazabi and PostHog logs (`mode: 'logs'`) send through it and get the same handling.

- When the collector rejected records, the request fails with a `DrainDeliveryError` that is not retried and carries the count in `rejected`. Those records used to be lost without a log line. `sendBatchToOTLP` and `sendToOTLP` now throw in that case instead of resolving.
- In `createDrainPipeline`, `onDropped` gets the batch with reason `rejected`, and `drain.stats()` counts only the rejected records as dropped and the rest as delivered. A custom drain can do the same by throwing a `DrainDeliveryError` with `retryable: false` and `rejected`.
- A `partialSuccess` with only an `errorMessage` is logged with `console.warn`.
