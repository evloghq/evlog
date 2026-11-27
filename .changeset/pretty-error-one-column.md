---
"evlog": patch
---

The pretty terminal output prints everything under `error:` in one column. The location, the code snippet, `Code`, `Why`, `Fix`, `More`, `Caused by` and the stack were printed against the tree line, with empty tree lines between them. They are now indented under the message, with the snippet's line numbers in the same column and no empty line.

```
  ├─ error: Payment failed
  │     at handler (server/api/checkout.post.ts:42)
  │   ❯ 42 ┃   throw createError({ message: 'Payment failed', ... })
  │     Why: Card declined by issuer
  │     Fix: Try a different payment method
  ├─ user: id=usr_123
```
