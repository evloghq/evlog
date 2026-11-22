---
"evlog": major
---

`auditOnly(drain)` takes no options: remove `{ await: true }`, since every `log.audit()` call already waits for every drain. The audit store it wraps now receives emails, IPv4 addresses and phone numbers unmasked, while every other drain and stdout still get them masked. Paths, `secrets`, custom patterns, and the credential and card maskers apply to both. Only records made by `log.audit()` and `audit()` in the same process reach it.

`auditEnricher()` takes only `tenantId`, which fills `audit.tenantId` when the call left it empty. The `bridge` and `overwrite` options are removed: `log.audit()` records the request context itself, and the actor belongs in the call.
