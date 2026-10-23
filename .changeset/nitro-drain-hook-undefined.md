---
"evlog": patch
---

The Nitro plugin and the client ingest route no longer throw `Cannot read properties of undefined (reading 'catch')` on every request under Nitro 3. hookable 6 returns `undefined` from `callHook` when no `evlog:drain` hook is async, and evlog now accepts that.
