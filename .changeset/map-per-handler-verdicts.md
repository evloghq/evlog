---
'@evlog/cli': patch
---

`evlog map` scores each entry point on its own handler instead of on the whole file.

- In a file that declares several entry points (Express, Hono and Fastify routes, the methods of a Next.js `route.ts`, server actions, TanStack Start methods), one instrumented handler used to pass every other one in the file, and each route listed the same `event.fields`. Each entry point is now read from its handler and the functions, classes and constants of the same file it names. An import such as `stripe` marks only the handlers that use it as sensitive.
- `request.log.info()` in a Fastify app that never registers evlog's plugin no longer passes `wide-event`: that is Fastify's own logger. `req.log` and `request.log` count when the app registers evlog's middleware, or when the call is `set`, `audit` or `fork`. `request.evlog` is recognised.
- `c.get('log').set()` called without binding the logger first is credited in Hono.
- `evlog map --all` names each row of a shared file by its route (`index.ts · GET /health`). `evlog map <file>` lists the other entry points of the file, and `evlog map "POST /orders"` inspects one by method and path.

Scores drop in files where an instrumented route was covering for the others, so the rule-set version moves to 3. `--baseline` against a map written by an earlier CLI exits 2 with the version mismatch: run `evlog map` once and commit the new `evlog.map.json`.
