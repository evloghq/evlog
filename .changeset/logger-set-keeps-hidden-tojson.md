---
"evlog": patch
---

`log.set()` no longer exposes fields hidden by a `toJSON` method when the same key is set twice (regression in an unreleased change).
