---
"@evlog/cli": minor
---

`evlog map` and `evlog init` now support Express and Fastify. `map` finds `app.get('/path', …)` and `router.*` registrations (Fastify's `app.route({ method, url })` too), credits handlers that use `req.log` / `request.log`, and treats the per-request event as ambient once `app.use(evlog())` or `app.register(evlog)` is found. `init` writes `src/evlog.ts` with `initLogger` and the middleware (Express) or the plugin options (Fastify), and prints the registration line to paste. Internally every framework is now one directory under `lib/frameworks/`, so adding one no longer touches the scanner, the planner dispatch or the help text.
