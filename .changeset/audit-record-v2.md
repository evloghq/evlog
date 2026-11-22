---
"evlog": major
---

Audit records carry an `id`, a UUIDv7 unique per record, in place of `idempotencyKey`. The old key hashed the action, actor, target, outcome and second, so two real actions in the same second shared it. Key audit tables on `audit.id`.

`log.audit()` takes `tenantId`, stored at `audit.tenantId` instead of `audit.context.tenantId`, `metadata` for free-form detail, and `actor.onBehalfOf` for the user a token, agent or impersonating admin acted for. Records also carry `timestamp`, and `version` is `2`. `AuditInput` no longer accepts `version`. `evlog logs` shows an audit event delivered twice once, by its `audit.id`.
