---
'evlog': patch
---

Type `log.fork()` as always present on the request logger that an integration attaches: `c.get('log')` on Hono, `req.log` on Express and NestJS, `log` in Elysia handlers, `context.get(loggerContext)` on React Router and `context.log` on oRPC. Before, `fork` was optional there, so `c.get('log').fork(...)` failed a strict type check and needed `fork!` or `fork?.`. The new `ForkableLogger` type from `evlog` describes this logger, for example in SvelteKit's `App.Locals`. `useLogger()` still returns `AuditableLogger` with an optional `fork`, because inside `log.fork()` work it returns the forked logger, which has no `fork`.
