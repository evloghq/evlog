---
"evlog": patch
---

Fix Bun crashes and test lifecycle timeouts when importing the Elysia or eve integration by isolating the AsyncLocalStorage capability probe from the caller's context.
