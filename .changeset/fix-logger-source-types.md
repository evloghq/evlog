---
"evlog": patch
---

Preserve error details in global `log.error(Error)` calls and keep `audit()` calls safe when request logging is disabled or excluded. Correct generic logger accessor types and load the Nitro 3 hook declarations during source type checking.
