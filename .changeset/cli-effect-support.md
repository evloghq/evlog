---
"@evlog/cli": minor
---

`evlog map`, `evlog init` and `evlog doctor` recognise Effect 4 apps. `map` reads `HttpRouter.add` and `HttpRouter.route` registrations, credits `yield* EvlogLogger` and `yield* useLogger()` as the request logger, and treats `routerLayer()` as the per-request event. `init` writes `src/evlog.ts` with `initLoggerLayer` and `routerLayer` built from `evlog.config.ts`. An app that also uses Next.js, Hono or another framework keeps that framework, and an Effect 3 app (`@effect/platform`) is not detected. `--framework effect` forces it.

The "Could not detect a supported framework" error now lists every framework `map` supports, Express and Fastify included.
