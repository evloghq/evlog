---
'evlog': minor
---

Add an `enrichTurn` option to `defineEvlogHook()` in `evlog/eve`. It runs once per turn where the turn logger is created, with the eve session in scope, so enrichers can reach `ctx.session.auth` and the session lineage instead of only HTTP-shaped context. Returned fields merge onto the turn event over the built-in `eve`, `agent` and `channel` fields, and stay turn-scoped: they are not carried across turns of the same session. The existing `enrich` option keeps its HTTP-shaped context.
