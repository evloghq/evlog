---
"evlog": major
---

The HTTP error body sent by the Nitro, Nuxt and SvelteKit error handlers carries the status in `status` and the text in `message` only. The `statusCode`, `statusText` and `statusMessage` fields are gone: they repeated `status` and `message`. `url`, `error: true` and `data` are unchanged, and `why`, `fix` and `link` stay under `data`.

```diff
 {
   "url": "/api/checkout",
   "status": 402,
-  "statusCode": 402,
-  "statusText": "Payment failed",
-  "statusMessage": "Payment failed",
   "message": "Payment failed",
   "error": true,
   "data": { "why": "Card declined", "fix": "Use another card" }
 }
```

`parseError()` already reads `status` and `message`, so client code that goes through it needs no change. A client that read `statusCode` or `statusMessage` from the JSON body should read `status` and `message`. The HTTP status line itself is unchanged.
