---
"evlog": patch
---

Fix `request.log` on `@nestjs/platform-fastify`. `EvlogModule` now sets the evlog logger on `FastifyRequest.log` before guards, interceptors, pipes, and controllers run, so `request.log.set(...)` no longer throws `TypeError: request.log.set is not a function`. `FastifyRequest.log` is typed as the evlog logger when `evlog/nestjs` is imported.
