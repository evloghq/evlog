---
"evlog": major
---

A logged `EvlogError` carries `code`, `why`, `fix` and `link` once, at the top of `error`. Its `data` is now the payload passed to `createError({ data })` and nothing else, and it is left out when there is none. Before, the logged `data` repeated the guidance fields:

```diff
 "error": {
   "name": "EvlogError",
   "message": "Payment failed",
   "code": "PAYMENT_DECLINED",
   "status": 402,
   "why": "Card declined by issuer",
   "fix": "Try another card",
-  "data": { "retryAfter": 30, "code": "PAYMENT_DECLINED", "why": "Card declined by issuer", "fix": "Try another card" }
+  "data": { "retryAfter": 30 }
 }
```

This holds when h3 wraps the error too. A drain or saved query that read `error.data.why` should read `error.why`. The HTTP response is unchanged: its `data` still carries the guidance fields, which `parseError()` reads on the client.
