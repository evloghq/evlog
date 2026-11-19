---
'evlog': patch
---

The Sentry drain honours Sentry's rate limits per data category, like the official SDKs.

- It reads `X-Sentry-Rate-Limits` and `Retry-After` on every response, including accepted ones, and remembers them per DSN.
- While error events are limited, `issues: true` skips issues without sending them and logs one warning per limit window. The logs keep going out. Before, a burst of 500 errors made 500 issue requests while Sentry was dropping them.
- While logs are limited, `sendBatchToSentry` rejects without sending, with a `DrainDeliveryError` whose `retryAfterMs` is the remaining delay, so `createDrainPipeline` holds the batch until the limit expires.
- An issue Sentry rejects (such as a `400`) no longer stops the other issues of the batch. A transient failure still does.
