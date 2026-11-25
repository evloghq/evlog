---
"evlog": minor
---

Adds `evlog/webhook` to send audit records to an HTTPS endpoint as signed [Standard Webhooks](https://www.standardwebhooks.com) messages: `createWebhookDrain({ url, secret })` (or `EVLOG_WEBHOOK_URL` and `EVLOG_WEBHOOK_SECRET`), `verifyWebhook(body, headers, secret)` for the receiver, `sendAuditWebhook`, `signWebhook` and `generateWebhookSecret`. Pass two secrets to rotate.

Adds `relayAudit({ cursor, read, send, save })` to `evlog`, which forwards stored records to a destination in order behind a cursor, for an audit webhook per tenant. `save(next, previous)` receives the position it replaces, to compare-and-set against.
