---
"evlog": major
---

A logged error carries its HTTP status in `status` only. The `statusCode`, `statusText` and `statusMessage` fields are no longer written into the wide event or the log, on the server or in the browser, so a drain or a query that read them needs to read `status`. The message that `statusText` and `statusMessage` repeated is already logged as `message`.

An h3 or Nuxt error keeps its own `statusCode` as input: the logger reads it and logs it as `status`.

The logged error, trimmed to the fields that changed:

```json
{ "name": "EvlogError", "message": "Payment could not be completed", "status": 402, "data": { "why": "Card declined" } }
```

Before this change the same error also logged `statusCode: 402`, `statusText` and `statusMessage`.

A `toJSON` that leaves a field out now also keeps that field out after a second `set()` on the same key, so a field hidden by `toJSON` is no longer logged through that path.
