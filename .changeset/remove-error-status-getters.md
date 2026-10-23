---
"evlog": major
---

`EvlogError` no longer has the `statusCode`, `statusText` and `statusMessage` getters, deprecated since 2.x. Read `status` for the HTTP status and `message` for the text:

```diff
 const error = createError({ message: 'Payment failed', status: 402 })
-error.statusCode    // 402
-error.statusMessage // 'Payment failed'
+error.status        // 402
+error.message       // 'Payment failed'
```

Reading one of the removed fields now returns `undefined`, and TypeScript reports it. Errors thrown by h3 and Nuxt keep their own `statusCode`, and evlog still reads it from them.
