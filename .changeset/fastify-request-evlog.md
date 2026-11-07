---
'evlog': minor
---

`evlog/fastify` attaches the request logger to `request.evlog`, typed as `ForkableLogger`, so `request.evlog.set()`, `.fork()` and `.audit()` type-check. Fastify types `request.log` as its own logger, and a module augmentation cannot change the type of an existing property: `request.log.set()` failed with TS2339 even though it worked at runtime, and with `skipLibCheck: false` the published declarations reported TS2717. `request.log` still holds the evlog logger at runtime, so existing code keeps working. On a route that `include` or `exclude` filters out, or with `enabled: false`, `request.evlog` accepts every call and emits nothing. On `@nestjs/platform-fastify`, `evlog/nestjs` sets `request.evlog` the same way.
